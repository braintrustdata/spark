import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Box, Text } from "ink";
import { PNG } from "pngjs";

const LOGO_HEIGHT = 7;
const LOGO_WIDTH = 14;
const LOGO_PATHS = [
  fileURLToPath(new URL("../../assets/braintrust-logo.png", import.meta.url)),
  fileURLToPath(new URL("../assets/braintrust-logo.png", import.meta.url)),
];
const FALLBACK_LOGO_ROWS = [
  "    ███  ███   ",
  "  ████    ████ ",
  "  ███      ███ ",
  "  ████    ████ ",
  "  ███      ███ ",
  "  ████    ████ ",
  "    ███  ███   ",
];

type AlphaSampleOptions = {
  readonly column: number;
  readonly row: number;
  readonly isTopHalf: boolean;
  readonly png: PNG;
};

function hasVisiblePixels({ column, row, isTopHalf, png }: AlphaSampleOptions) {
  const sourceXStart = Math.floor((column / LOGO_WIDTH) * png.width);
  const sourceXEnd = Math.ceil(((column + 1) / LOGO_WIDTH) * png.width);
  const rowStartRatio = (row + (isTopHalf ? 0 : 0.5)) / LOGO_HEIGHT;
  const rowEndRatio = (row + (isTopHalf ? 0.5 : 1)) / LOGO_HEIGHT;
  const sourceYStart = Math.floor(rowStartRatio * png.height);
  const sourceYEnd = Math.ceil(rowEndRatio * png.height);
  let visiblePixels = 0;
  let totalPixels = 0;

  for (let y = sourceYStart; y < sourceYEnd; y += 1) {
    for (let x = sourceXStart; x < sourceXEnd; x += 1) {
      const offset = (png.width * y + x) << 2;
      const alpha = png.data[offset + 3] ?? 0;

      totalPixels += 1;

      if (alpha > 64) {
        visiblePixels += 1;
      }
    }
  }

  return totalPixels > 0 && visiblePixels / totalPixels > 0.2;
}

function loadLogoRows() {
  for (const logoPath of LOGO_PATHS) {
    try {
      const png = PNG.sync.read(readFileSync(logoPath));
      const rows: string[] = [];

      for (let row = 0; row < LOGO_HEIGHT; row += 1) {
        let line = "";

        for (let column = 0; column < LOGO_WIDTH; column += 1) {
          const top = hasVisiblePixels({
            column,
            isTopHalf: true,
            png,
            row,
          });
          const bottom = hasVisiblePixels({
            column,
            isTopHalf: false,
            png,
            row,
          });

          if (top && bottom) {
            line += "█";
          } else if (top) {
            line += "▀";
          } else if (bottom) {
            line += "▄";
          } else {
            line += " ";
          }
        }

        rows.push(line);
      }

      return rows;
    } catch {
      continue;
    }
  }

  return FALLBACK_LOGO_ROWS;
}

const logoRows = loadLogoRows();

export const brandLogoHeight = logoRows.length;
export const brandLogoWidth = Math.max(...logoRows.map((row) => row.length));

type BrandLogoProps = {
  readonly color: string;
  readonly cropLeftColumns?: number;
};

export function BrandLogo({ color, cropLeftColumns = 0 }: BrandLogoProps) {
  const visibleWidth = Math.max(0, brandLogoWidth - cropLeftColumns);

  if (visibleWidth === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" width={visibleWidth}>
      {logoRows.map((row, index) => (
        <Text color={color} key={`${index}:${row}`}>
          {row.slice(cropLeftColumns)}
        </Text>
      ))}
    </Box>
  );
}
