import { Box, Text } from "ink";
import { useEffect, useState } from "react";

const EMPTY_BLOCK = " ";
const LEFT_BLOCK = "▌";
const RIGHT_BLOCK = "▐";
const LEFT_SUBCOLUMN = 0b01;
const RIGHT_SUBCOLUMN = 0b10;
const STRIP_TICK_MS = 180;
const BASE_LINE_SPACING = 5;
const STRIP_PERIOD = 320;
const FIRST_BLOCK_GAP_ROW = 1;
const LAST_BLOCK_GAP_ROW = 4;
const GAPLESS_ROW = 3;
const MIN_BLOCK_GAP_PERIOD = 11;
const BLOCK_GAP_PERIOD_VARIATION = 8;
const MIN_BLOCK_GAP_SPAN = 3;
const BLOCK_GAP_SPAN_VARIATION = 4;
const EDGE_ROW_MIN_DENSITY = 0.2;
const EDGE_ROW_DENSITY_VARIATION = 0.12;
const MIDDLE_ROW_MIN_DENSITY = 0.68;
const MIDDLE_ROW_DENSITY_VARIATION = 0.22;
const FEATURED_ROW = 2;
const FEATURED_ROW_SPEED = 1.35;
const BASE_ROW_SPEED = 0.78;
const ROW_SPEED_VARIATION = 0.28;

type SignalStripsProps = {
  readonly columns: number;
  readonly color: string;
  readonly rows: number;
};

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function hash(value: number) {
  let hashedValue = value | 0;

  hashedValue ^= hashedValue >>> 16;
  hashedValue = Math.imul(hashedValue, 0x7feb352d);
  hashedValue ^= hashedValue >>> 15;
  hashedValue = Math.imul(hashedValue, 0x846ca68b);
  hashedValue ^= hashedValue >>> 16;

  return (hashedValue >>> 0) / 0x100000000;
}

function hashAt(x: number, y: number, salt: number) {
  return hash(Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ salt);
}

function rowDirection(row: number) {
  return hashAt(row, 0, 311) > 0.5 ? 1 : -1;
}

function rowSpeed(row: number) {
  if (row === FEATURED_ROW) {
    return FEATURED_ROW_SPEED;
  }

  return BASE_ROW_SPEED + hashAt(row, 0, 1291) * ROW_SPEED_VARIATION;
}

function isSparseEdgeRow(row: number, rows: number) {
  return row === 0 || row >= rows - 2;
}

function hasBlockGaps(row: number, rows: number) {
  return (
    row >= FIRST_BLOCK_GAP_ROW &&
    row <= LAST_BLOCK_GAP_ROW &&
    row !== GAPLESS_ROW &&
    !isSparseEdgeRow(row, rows)
  );
}

function rowDensity(row: number, rows: number) {
  if (row === GAPLESS_ROW) {
    return 1;
  }

  if (isSparseEdgeRow(row, rows)) {
    return (
      EDGE_ROW_MIN_DENSITY + hashAt(row, rows, 719) * EDGE_ROW_DENSITY_VARIATION
    );
  }

  return (
    MIDDLE_ROW_MIN_DENSITY +
    hashAt(row, rows, 719) * MIDDLE_ROW_DENSITY_VARIATION
  );
}

function rowBlockGapPeriod(row: number) {
  return (
    MIN_BLOCK_GAP_PERIOD +
    Math.floor(hashAt(row, 0, 2053) * BLOCK_GAP_PERIOD_VARIATION)
  );
}

function rowBlockGapSpan(row: number) {
  return (
    MIN_BLOCK_GAP_SPAN +
    Math.floor(hashAt(row, 0, 2381) * BLOCK_GAP_SPAN_VARIATION)
  );
}

function rowBlockGapPhase(row: number, period: number) {
  return Math.floor(hashAt(row, 0, 2741) * period);
}

function isInBlockGap(lineIndex: number, row: number, rows: number) {
  if (!hasBlockGaps(row, rows)) {
    return false;
  }

  const period = rowBlockGapPeriod(row);
  const span = rowBlockGapSpan(row);
  const phase = rowBlockGapPhase(row, period);
  const blockPosition = positiveModulo(lineIndex - phase, period);

  return blockPosition < span;
}

function rowPhase(row: number) {
  return Math.floor(hashAt(row, 0, 421) * BASE_LINE_SPACING);
}

function worldSubColumn(column: number, row: number, elapsedMs: number) {
  const elapsedSeconds = elapsedMs / 1000;
  const drift =
    Math.floor(elapsedSeconds * rowSpeed(row)) * rowDirection(row) + row * 53;

  return positiveModulo(column + drift, STRIP_PERIOD);
}

function lineIndexAt(worldColumn: number, row: number) {
  const phase = rowPhase(row);
  const normalizedColumn = positiveModulo(worldColumn - phase, STRIP_PERIOD);

  if (normalizedColumn % BASE_LINE_SPACING !== 0) {
    return null;
  }

  return normalizedColumn / BASE_LINE_SPACING;
}

function shouldRenderLine(lineIndex: number, row: number, rows: number) {
  return (
    !isInBlockGap(lineIndex, row, rows) &&
    hashAt(lineIndex, row, 17) < rowDensity(row, rows)
  );
}

function hasLineAt(
  column: number,
  row: number,
  rows: number,
  elapsedMs: number,
) {
  const worldColumn = worldSubColumn(column, row, elapsedMs);
  const lineIndex = lineIndexAt(worldColumn, row);

  return lineIndex !== null && shouldRenderLine(lineIndex, row, rows);
}

function blockForMask(mask: number) {
  if (mask === LEFT_SUBCOLUMN) {
    return LEFT_BLOCK;
  }

  if (mask === RIGHT_SUBCOLUMN) {
    return RIGHT_BLOCK;
  }

  if ((mask & LEFT_SUBCOLUMN) !== 0) {
    return LEFT_BLOCK;
  }

  return EMPTY_BLOCK;
}

function buildStripLine(
  columns: number,
  row: number,
  rows: number,
  elapsedMs: number,
) {
  let line = "";

  for (let column = 0; column < columns; column += 1) {
    const mask =
      (hasLineAt(column * 2, row, rows, elapsedMs) ? LEFT_SUBCOLUMN : 0) |
      (hasLineAt(column * 2 + 1, row, rows, elapsedMs) ? RIGHT_SUBCOLUMN : 0);

    line += blockForMask(mask);
  }

  return line;
}

export function SignalStrips({ columns, color, rows }: SignalStripsProps) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, STRIP_TICK_MS);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return (
    <Box flexDirection="column" width={columns}>
      {Array.from({ length: rows }, (_, row) => (
        <Text color={color} key={row}>
          {buildStripLine(columns, row, rows, elapsedMs)}
        </Text>
      ))}
    </Box>
  );
}
