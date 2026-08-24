export interface Hsl { h: number; s: number; l: number }

export function hexToHsl(hex: string): Hsl {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const lightness = (maximum + minimum) / 2
  if (maximum === minimum) return { h: 0, s: 0, l: Math.round(lightness * 100) }
  const delta = maximum - minimum
  const saturation = lightness > 0.5 ? delta / (2 - maximum - minimum) : delta / (maximum + minimum)
  let hue: number
  if (maximum === red) hue = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
  else if (maximum === green) hue = ((blue - red) / delta + 2) / 6
  else hue = ((red - green) / delta + 4) / 6
  return { h: Math.round(hue * 360), s: Math.round(saturation * 100), l: Math.round(lightness * 100) }
}

export function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100
  const lightness = l / 100
  const k = (n: number) => (n + h / 30) % 12
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => lightness - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return `#${[channel(0), channel(8), channel(4)].map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Faction colors on the global map must be unique. If the requested color is
 * already taken by another faction, walk lightness (then saturation) until a
 * free shade is found.
 */
export function ensureUniqueFactionColor(requested: string, takenColors: string[]): string {
  const taken = new Set(takenColors.map((color) => color.toLowerCase()))
  const normalized = `#${requested.replace('#', '').slice(0, 6)}`.toLowerCase()
  if (!taken.has(normalized)) return normalized
  const { h, s, l } = hexToHsl(normalized)
  for (let step = 1; step <= 40; step += 1) {
    const lightnessShift = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 4
    const lightness = Math.min(92, Math.max(8, l + lightnessShift))
    const saturation = step > 24 ? Math.min(95, Math.max(20, s + (step - 24) * 5)) : s
    const candidate = hslToHex(h, saturation, lightness)
    if (!taken.has(candidate)) return candidate
  }
  return normalized
}
