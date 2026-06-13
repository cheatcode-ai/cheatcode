import { createLogger } from "@cheatcode/observability";
import { type GreetingResponse, GreetingResponseSchema } from "@cheatcode/types";
import { z } from "zod";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const WEATHER_FETCH_TIMEOUT_MS = 1_500;
const WEATHER_CACHE_MAX_AGE_SECONDS = 900;

const CfGeoSchema = z.object({
  city: z.string().min(1).optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  timezone: z.string().min(1).optional(),
});

const WeatherSchema = z
  .object({
    tempC: z.number(),
    weatherCode: z.number().int(),
  })
  .strict();
type Weather = z.infer<typeof WeatherSchema>;

const OpenMeteoCurrentSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    weather_code: z.number(),
  }),
});

type WeatherFailureReason = "no_geo" | "parse" | "timeout" | "upstream_status";

interface ResolvedGeo {
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
}

/**
 * Returns Cloudflare-edge geo plus best-effort Open-Meteo weather. Any upstream
 * failure degrades to `weather: null` while still answering HTTP 200; the client
 * falls back to a time-only greeting. Never returns a server clock.
 */
export async function greetingRoute(ctx: ExecutionContext, request: Request): Promise<Response> {
  const geo = resolveGeo(request);
  const weather = await resolveWeather(ctx, geo);
  const response: GreetingResponse = {
    city: geo.city,
    timezone: geo.timezone,
    weather,
  };
  return Response.json(GreetingResponseSchema.parse(response));
}

function resolveGeo(request: Request): ResolvedGeo {
  const cf: unknown = request.cf;
  const parsed = CfGeoSchema.safeParse(cf);
  if (!parsed.success) {
    return { city: null, latitude: null, longitude: null, timezone: null };
  }
  return {
    city: parsed.data.city ?? null,
    latitude: parseCoord(parsed.data.latitude),
    longitude: parseCoord(parsed.data.longitude),
    timezone: parsed.data.timezone ?? null,
  };
}

function parseCoord(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveWeather(ctx: ExecutionContext, geo: ResolvedGeo): Promise<Weather | null> {
  if (geo.latitude === null || geo.longitude === null) {
    createLogger().warn("greeting_weather_fetch_failed", { reason: "no_geo" });
    return null;
  }
  return loadWeather(ctx, geo.latitude, geo.longitude);
}

async function loadWeather(
  ctx: ExecutionContext,
  latitude: number,
  longitude: number,
): Promise<Weather | null> {
  const latBucket = roundCoord(latitude);
  const lonBucket = roundCoord(longitude);
  const cacheKey = `https://weather.cache.cheatcode.internal/v1?lat=${latBucket}&lon=${lonBucket}`;
  // The `WebWorker` lib's CacheStorage shadows the Cloudflare `default` edge cache;
  // assert the precise shape rather than widening to `any`.
  const cache = (caches as CacheStorage & { readonly default: Cache }).default;
  const cached = await readWeatherCache(cache, cacheKey);
  createLogger().debug("greeting_weather_cache", { hit: cached !== null });
  if (cached) {
    return cached;
  }
  const weather = await fetchOpenMeteo(latBucket, lonBucket);
  if (weather) {
    ctx.waitUntil(writeWeatherCache(cache, cacheKey, weather));
  }
  return weather;
}

async function readWeatherCache(cache: Cache, key: string): Promise<Weather | null> {
  try {
    const response = await cache.match(key);
    if (!response) {
      return null;
    }
    const parsed = WeatherSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // A cache read failure is non-fatal; fall through to a fresh upstream fetch.
    return null;
  }
}

async function writeWeatherCache(cache: Cache, key: string, weather: Weather): Promise<void> {
  try {
    const response = new Response(JSON.stringify(weather), {
      headers: {
        "Cache-Control": `public, max-age=${WEATHER_CACHE_MAX_AGE_SECONDS}`,
        "Content-Type": "application/json",
      },
    });
    await cache.put(key, response);
  } catch {
    // Cache writes are best-effort; the weather payload is already resolved.
  }
}

async function fetchOpenMeteo(latitude: number, longitude: number): Promise<Weather | null> {
  try {
    const url = `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
    const response = await fetch(url, { signal: AbortSignal.timeout(WEATHER_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      logWeatherFailure("upstream_status", latitude, longitude, response.status);
      return null;
    }
    const parsed = OpenMeteoCurrentSchema.safeParse(await response.json());
    if (!parsed.success) {
      logWeatherFailure("parse", latitude, longitude);
      return null;
    }
    return {
      tempC: parsed.data.current.temperature_2m,
      weatherCode: Math.trunc(parsed.data.current.weather_code),
    };
  } catch (error) {
    logWeatherFailure(timeoutOrParse(error), latitude, longitude);
    return null;
  }
}

function timeoutOrParse(error: unknown): WeatherFailureReason {
  return error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "parse";
}

function logWeatherFailure(
  reason: WeatherFailureReason,
  latitude: number,
  longitude: number,
  status?: number,
): void {
  createLogger().warn("greeting_weather_fetch_failed", {
    latBucket: roundCoord(latitude),
    lonBucket: roundCoord(longitude),
    reason,
    ...(status === undefined ? {} : { status }),
  });
}

function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}
