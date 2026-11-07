// WEATHER, fast. "What's the weather in Rudrapur?" went through web_search: a Gemini call with Google
// Search, 4-12 s before Orbi could even start talking (Abhay, 2026-10-21: "why does it take so long?").
// Open-Meteo (free, no key, open data) answers in well under a second: find the place, then its forecast.
// Only the place name leaves this computer.

import type { Tool } from './tool'

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// WMO weather codes (what Open-Meteo returns) → words.
const CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers',
  82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorm',
  96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail'
}
export const describeCode = (code: number): string => CODES[code] ?? 'unknown conditions'

interface Place {
  name: string
  admin1?: string
  country?: string
  latitude: number
  longitude: number
}

// "Rudrapur, Uttarakhand" → search "Rudrapur", prefer the result whose state/country matches the rest.
export function pickPlace(query: string, results: Place[]): Place | null {
  if (results.length === 0) return null
  const hints = query.split(',').slice(1).map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (hints.length === 0) return results[0]
  const fits = (p: Place): boolean => hints.every((h) => [p.admin1, p.country].some((v) => v?.toLowerCase().includes(h)))
  return results.find(fits) ?? results[0]
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`the weather service answered ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

export const getWeather: Tool = {
  name: 'get_weather',
  description:
    'Weather now and the forecast (today, tomorrow, the day after) for a place: temperature in °C, conditions, ' +
    'chance of rain, wind. Fast. Use it for any weather question instead of web_search. `place` like "Rudrapur, ' +
    'Uttarakhand" or "London"; `day` 0 = today, 1 = tomorrow, 2 = the day after.',
  parameters: {
    type: 'object',
    properties: { place: { type: 'string' }, day: { type: 'integer', minimum: 0, maximum: 2 } },
    required: ['place']
  },
  risk: 'low',
  effect: 'upload', // the place name goes to Open-Meteo
  async run(args) {
    const query = str(args.place)
    if (!query) return { ok: false, error: 'Which place? Ask the user for a city.' }
    const day = typeof args.day === 'number' ? Math.max(0, Math.min(2, Math.round(args.day))) : 0
    try {
      const name = query.split(',')[0].trim()
      const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`)
      const place = pickPlace(query, (geo.results as Place[] | undefined) ?? [])
      if (!place) return { ok: false, error: `I couldn't find a place called "${query}".` }
      const f = await getJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
          '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3'
      )
      const cur = f.current as Record<string, number>
      const d = f.daily as Record<string, number[] | string[]>
      const where = [place.name, place.admin1, place.country].filter(Boolean).join(', ')
      return {
        ok: true,
        place: where,
        ...(day === 0
          ? {
              now: {
                temperatureC: cur.temperature_2m,
                feelsLikeC: cur.apparent_temperature,
                conditions: describeCode(cur.weather_code),
                humidityPercent: cur.relative_humidity_2m,
                windKmh: cur.wind_speed_10m
              }
            }
          : {}),
        forecast: {
          date: (d.time as string[])[day],
          conditions: describeCode((d.weather_code as number[])[day]),
          highC: (d.temperature_2m_max as number[])[day],
          lowC: (d.temperature_2m_min as number[])[day],
          rainChancePercent: (d.precipitation_probability_max as number[])[day]
        },
        source: 'Open-Meteo'
      }
    } catch (err) {
      return { ok: false, error: `The weather service didn't answer (${err instanceof Error ? err.message : String(err)}). Try web_search instead.` }
    }
  }
}
