import { Box, Text } from "ink";

const LOGO_WIDTH = 14;
const LOGO_ROWS = [
  "  ███▌▐███",
  "▟████▘▝████▙",
  "▜████▖▗████▛",
  "▟████▘▝████▙",
  "▜████▖▗████▛",
  "  ███▌▐███",
].map((row) => row.padEnd(LOGO_WIDTH, " "));

export const brandLogoHeight = LOGO_ROWS.length;
export const brandLogoWidth = LOGO_WIDTH;

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
      {LOGO_ROWS.map((row, index) => (
        <Text color={color} key={`${index}:${row}`}>
          {row.slice(cropLeftColumns)}
        </Text>
      ))}
    </Box>
  );
}
