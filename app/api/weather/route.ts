import {
  fetchWithTimeout,
  readResponseText,
  ResponseSizeError,
  UpstreamTimeoutError,
} from "../_limits";
import { protectApiRequest } from "../_security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    weather_code?: number[];
  };
};

function weatherDescription(code = -1) {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzly";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rainy";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snowy";
  if ([95, 96, 99].includes(code)) return "stormy";
  return "mixed conditions";
}

function coordinate(value: string | null, fallback: string | undefined) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const securityError = protectApiRequest(request, {
    scope: "weather",
    limit: 30,
  });

  if (securityError) return securityError;

  try {
    const requestUrl = new URL(request.url);
    const latitude = coordinate(
      requestUrl.searchParams.get("latitude"),
      process.env.WEATHER_LATITUDE,
    );
    const longitude = coordinate(
      requestUrl.searchParams.get("longitude"),
      process.env.WEATHER_LONGITUDE,
    );
    const tomorrow = requestUrl.searchParams.get("day") === "tomorrow";
    const dayIndex = tomorrow ? 1 : 0;

    if (
      latitude === null ||
      longitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return Response.json(
        { error: "Allow location access so I can check your local weather, Sir." },
        { status: 400 },
      );
    }

    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,apparent_temperature,weather_code",
      daily:
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      forecast_days: tomorrow ? "2" : "1",
      timezone: "auto",
    });
    const response = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?${params}`,
      {},
      10_000,
      request.signal,
    );

    if (!response.ok) {
      return Response.json(
        { error: "The weather service did not return a forecast, Sir." },
        { status: 502 },
      );
    }

    const text = await readResponseText(
      response,
      256 * 1024,
      10_000,
      request.signal,
    );
    const forecast = JSON.parse(text) as ForecastResponse;
    const high = forecast.daily?.temperature_2m_max?.[dayIndex];
    const low = forecast.daily?.temperature_2m_min?.[dayIndex];
    const rainChance =
      forecast.daily?.precipitation_probability_max?.[dayIndex];
    const dailyCode = forecast.daily?.weather_code?.[dayIndex];

    if (typeof high !== "number" || typeof low !== "number") {
      return Response.json(
        { error: "The weather forecast was incomplete, Sir." },
        { status: 502 },
      );
    }

    const period = tomorrow ? "Tomorrow" : "Today";
    const condition = weatherDescription(
      tomorrow ? dailyCode : forecast.current?.weather_code ?? dailyCode,
    );
    const current =
      !tomorrow && typeof forecast.current?.temperature_2m === "number"
        ? `It is currently ${Math.round(forecast.current.temperature_2m)}°C and ${condition}` +
          (typeof forecast.current.apparent_temperature === "number"
            ? `, feeling like ${Math.round(forecast.current.apparent_temperature)}°C. `
            : ". ")
        : `${period} will be ${condition}. `;
    const answer =
      `${current}${period}'s high is ${Math.round(high)}°C and the low is ${Math.round(low)}°C` +
      (typeof rainChance === "number"
        ? `, with up to a ${Math.round(rainChance)}% chance of rain.`
        : ".");

    return Response.json({
      answer,
      sourceTitle: "Open-Meteo",
      sourceUrl: "https://open-meteo.com/",
    });
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return Response.json(
        { error: "The weather service did not respond in time, Sir." },
        { status: 504 },
      );
    }
    if (error instanceof ResponseSizeError) {
      return Response.json(
        { error: "The weather service returned too much data." },
        { status: 502 },
      );
    }
    return Response.json(
      { error: "I could not retrieve the weather right now, Sir." },
      { status: 500 },
    );
  }
}
