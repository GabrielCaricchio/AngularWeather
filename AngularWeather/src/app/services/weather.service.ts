import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, from } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { Geolocation } from '@capacitor/geolocation';

export interface WeatherCondition {
  text: string;
  icon: string;
  class: string;
}

export interface City {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string; // State/Region
}

export interface CurrentWeather {
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  pressure: number;
  isDay: boolean;
  weatherCode: number;
  condition: WeatherCondition;
}

export interface HourlyForecast {
  time: string;
  temperature: number;
  weatherCode: number;
  condition: WeatherCondition;
}

export interface DailyForecast {
  date: string;
  dayOfWeek: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  condition: WeatherCondition;
  uvIndex: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherData {
  city: City;
  current: CurrentWeather;
  hourly: HourlyForecast[];
  daily: DailyForecast[];
  isCached?: boolean;
  cachedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class WeatherService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  constructor() {}

  // Helper to map WMO code to Portuguese description, nice SVG icon, and background class
  public getWeatherCondition(code: number, isDay: boolean = true): WeatherCondition {
    // Standard WMO weather codes
    switch (code) {
      case 0:
        return {
          text: 'Céu limpo',
          icon: isDay ? 'sunny' : 'moon',
          class: isDay ? 'weather-sunny-day' : 'weather-clear-night'
        };
      case 1:
      case 2:
      case 3:
        return {
          text: code === 1 ? 'Principalmente limpo' : code === 2 ? 'Parcialmente nublado' : 'Encoberto',
          icon: isDay ? 'partly-cloudy-day' : 'partly-cloudy-night',
          class: isDay ? 'weather-cloudy-day' : 'weather-cloudy-night'
        };
      case 45:
      case 48:
        return {
          text: 'Nevoeiro',
          icon: 'fog',
          class: 'weather-fog'
        };
      case 51:
      case 53:
      case 55:
        return {
          text: 'Chuvisco',
          icon: 'drizzle',
          class: 'weather-drizzle'
        };
      case 56:
      case 57:
        return {
          text: 'Chuvisco congelante',
          icon: 'snow-sleet',
          class: 'weather-snow'
        };
      case 61:
      case 63:
      case 65:
        return {
          text: code === 61 ? 'Chuva fraca' : code === 63 ? 'Chuva moderada' : 'Chuva forte',
          icon: 'rainy',
          class: 'weather-rainy'
        };
      case 66:
      case 67:
        return {
          text: 'Chuva congelante',
          icon: 'snow-sleet',
          class: 'weather-snow'
        };
      case 71:
      case 73:
      case 75:
        return {
          text: code === 71 ? 'Neve fraca' : code === 73 ? 'Neve moderada' : 'Neve forte',
          icon: 'snowy',
          class: 'weather-snow'
        };
      case 77:
        return {
          text: 'Granizo miúdo',
          icon: 'snow-hail',
          class: 'weather-snow'
        };
      case 80:
      case 81:
      case 82:
        return {
          text: 'Pancadas de chuva',
          icon: 'rain-showers',
          class: 'weather-rainy'
        };
      case 85:
      case 86:
        return {
          text: 'Pancadas de neve',
          icon: 'snow-showers',
          class: 'weather-snow'
        };
      case 95:
        return {
          text: 'Tempestade',
          icon: 'thunderstorm',
          class: 'weather-storm'
        };
      case 96:
      case 99:
        return {
          text: 'Tempestade com granizo',
          icon: 'thunderstorm-hail',
          class: 'weather-storm'
        };
      default:
        return {
          text: 'Desconhecido',
          icon: 'cloudy',
          class: 'weather-cloudy-day'
        };
    }
  }

  // Geocoding API: search city by name
  public searchCity(name: string): Observable<City[]> {
    if (!name || name.trim().length < 2) {
      return of([]);
    }
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=pt&format=json`;
    return this.http.get<any>(url).pipe(
      map(res => {
        if (!res.results) return [];
        return res.results.map((item: any) => ({
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          country: item.country,
          admin1: item.admin1
        }));
      }),
      catchError(err => {
        console.error('Error searching cities:', err);
        return of([]);
      })
    );
  }

  // Reverse geocoding: coordinates to city name
  public reverseGeocode(lat: number, lon: number): Observable<City> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=pt`;
    // Add a custom headers object with standard user agent to avoid osm blocking
    return this.http.get<any>(url).pipe(
      map(res => {
        const address = res.address || {};
        const cityName = address.city || address.town || address.village || address.suburb || 'Localização Atual';
        const country = address.country || '';
        const admin1 = address.state || address.region || '';
        return {
          name: cityName,
          latitude: lat,
          longitude: lon,
          country,
          admin1
        };
      }),
      catchError(err => {
        console.warn('Nominatim reverse geocoding failed, falling back:', err);
        return of({
          name: 'Localização Atual',
          latitude: lat,
          longitude: lon,
          country: 'GPS'
        });
      })
    );
  }

  // Fetch full weather data from Open-Meteo
  public getWeather(city: City): Observable<WeatherData> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,relative_humidity_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset&timezone=auto`;
    
    return this.http.get<any>(url).pipe(
      map(res => {
        const current = res.current;
        const hourly = res.hourly;
        const daily = res.daily;

        // Parse current weather
        const currentWeather: CurrentWeather = {
          temperature: current.temperature_2m,
          apparentTemperature: current.apparent_temperature,
          humidity: current.relative_humidity_2m,
          windSpeed: current.wind_speed_10m,
          windDirection: current.wind_direction_10m,
          cloudCover: current.cloud_cover,
          pressure: current.pressure_msl,
          isDay: current.is_day === 1,
          weatherCode: current.weather_code,
          condition: this.getWeatherCondition(current.weather_code, current.is_day === 1)
        };

        // Parse hourly forecast (next 24 hours starting from current hour)
        const currentHour = new Date().getHours();
        const hourlyForecasts: HourlyForecast[] = [];
        const startIndex = res.hourly.time.findIndex((tStr: string) => {
          const tDate = new Date(tStr);
          return tDate.getDate() === new Date().getDate() && tDate.getHours() === currentHour;
        }) || 0;

        const effectiveStartIndex = startIndex >= 0 ? startIndex : 0;
        
        for (let i = 0; i < 24; i++) {
          const idx = effectiveStartIndex + i;
          if (idx >= hourly.time.length) break;
          const time = hourly.time[idx];
          const timeDate = new Date(time);
          const formattedTime = timeDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const isHourDay = timeDate.getHours() > 6 && timeDate.getHours() < 18;
          hourlyForecasts.push({
            time: formattedTime,
            temperature: hourly.temperature_2m[idx],
            weatherCode: hourly.weather_code[idx],
            condition: this.getWeatherCondition(hourly.weather_code[idx], isHourDay)
          });
        }

        // Parse daily forecast (7 days)
        const dailyForecasts: DailyForecast[] = [];
        for (let i = 0; i < daily.time.length; i++) {
          const dStr = daily.time[i];
          const dDate = new Date(dStr + 'T00:00:00');
          const weekday = dDate.toLocaleDateString('pt-BR', { weekday: 'long' });
          const weekdayCapitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
          
          const sunriseTime = new Date(daily.sunrise[i]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          const sunsetTime = new Date(daily.sunset[i]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          dailyForecasts.push({
            date: dDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            dayOfWeek: weekdayCapitalized,
            tempMax: daily.temperature_2m_max[i],
            tempMin: daily.temperature_2m_min[i],
            weatherCode: daily.weather_code[i],
            condition: this.getWeatherCondition(daily.weather_code[i], true),
            uvIndex: daily.uv_index_max[i],
            sunrise: sunriseTime,
            sunset: sunsetTime
          });
        }

        const weatherData: WeatherData = {
          city,
          current: currentWeather,
          hourly: hourlyForecasts,
          daily: dailyForecasts,
          isCached: false
        };

        // Cache the weather data
        this.saveToCache(city, weatherData);

        return weatherData;
      }),
      catchError(err => {
        console.warn('Network call failed, searching cache...', err);
        const cached = this.getFromCache(city);
        if (cached) {
          return of(cached);
        }
        return throwError(() => new Error('Falha ao conectar com o serviço de clima e nenhum dado em cache encontrado.'));
      })
    );
  }

  // Get current user identifier to isolate data
  private getUserKey(prefix: string): string {
    const user = this.authService.currentUser();
    const username = user ? user.username.toLowerCase() : 'anonymous';
    return `${prefix}_${username}`;
  }

  // --- Cache Section ---
  private saveToCache(city: City, data: WeatherData): void {
    try {
      const cacheKey = this.getUserKey('weather_cache');
      const cacheJson = localStorage.getItem(cacheKey) || '{}';
      const cache = JSON.parse(cacheJson);
      
      const cityKey = `${city.latitude.toFixed(4)},${city.longitude.toFixed(4)}`;
      cache[cityKey] = {
        data,
        timestamp: Date.now()
      };
      
      localStorage.setItem(cacheKey, JSON.stringify(cache));
      // Save as last searched city
      localStorage.setItem(this.getUserKey('last_searched'), JSON.stringify(city));
    } catch (e) {
      console.error('Error saving weather to cache', e);
    }
  }

  private getFromCache(city: City): WeatherData | null {
    try {
      const cacheKey = this.getUserKey('weather_cache');
      const cacheJson = localStorage.getItem(cacheKey);
      if (!cacheJson) return null;
      
      const cache = JSON.parse(cacheJson);
      const cityKey = `${city.latitude.toFixed(4)},${city.longitude.toFixed(4)}`;
      const cachedItem = cache[cityKey];
      
      if (cachedItem) {
        const date = new Date(cachedItem.timestamp);
        const formattedDate = date.toLocaleString('pt-BR');
        return {
          ...cachedItem.data,
          isCached: true,
          cachedAt: formattedDate
        };
      }
    } catch (e) {
      console.error('Error reading from cache', e);
    }
    return null;
  }

  public getLastSearchedCity(): City | null {
    try {
      const last = localStorage.getItem(this.getUserKey('last_searched'));
      return last ? JSON.parse(last) : null;
    } catch (e) {
      return null;
    }
  }

  // --- Geolocation Section (GPS) ---
  public getCoordinates(): Observable<{ latitude: number; longitude: number }> {
    return from(Geolocation.getCurrentPosition()).pipe(
      map(coordinates => ({
        latitude: coordinates.coords.latitude,
        longitude: coordinates.coords.longitude
      })),
      catchError(err => {
        console.warn('Capacitor Geolocation failed. Trying browser geolocation...', err);
        return new Observable<{ latitude: number; longitude: number }>(subscriber => {
          if (!navigator.geolocation) {
            subscriber.error(new Error('Geolocalização não é suportada por este navegador.'));
            return;
          }
          navigator.geolocation.getCurrentPosition(
            position => {
              subscriber.next({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              });
              subscriber.complete();
            },
            geoErr => {
              subscriber.error(geoErr);
            },
            { timeout: 10000, enableHighAccuracy: true }
          );
        });
      })
    );
  }

  public getWeatherByGPS(): Observable<WeatherData> {
    return this.getCoordinates().pipe(
      switchMap(coords => this.reverseGeocode(coords.latitude, coords.longitude)),
      switchMap(city => this.getWeather(city))
    );
  }

  // --- Favorites Section ---
  public getFavorites(): City[] {
    try {
      const favsJson = localStorage.getItem(this.getUserKey('favorites'));
      return favsJson ? JSON.parse(favsJson) : [];
    } catch (e) {
      return [];
    }
  }

  public addFavorite(city: City): void {
    try {
      const favs = this.getFavorites();
      const exists = favs.some(
        c => c.latitude.toFixed(4) === city.latitude.toFixed(4) && c.longitude.toFixed(4) === city.longitude.toFixed(4)
      );
      if (!exists) {
        favs.push(city);
        localStorage.setItem(this.getUserKey('favorites'), JSON.stringify(favs));
      }
    } catch (e) {
      console.error('Error adding favorite', e);
    }
  }

  public removeFavorite(city: City): void {
    try {
      let favs = this.getFavorites();
      favs = favs.filter(
        c => !(c.latitude.toFixed(4) === city.latitude.toFixed(4) && c.longitude.toFixed(4) === city.longitude.toFixed(4))
      );
      localStorage.setItem(this.getUserKey('favorites'), JSON.stringify(favs));
    } catch (e) {
      console.error('Error removing favorite', e);
    }
  }

  public isFavorite(city: City): boolean {
    const favs = this.getFavorites();
    return favs.some(
      c => c.latitude.toFixed(4) === city.latitude.toFixed(4) && c.longitude.toFixed(4) === city.longitude.toFixed(4)
    );
  }

  // --- History Section ---
  public getHistory(): City[] {
    try {
      const histJson = localStorage.getItem(this.getUserKey('history'));
      return histJson ? JSON.parse(histJson) : [];
    } catch (e) {
      return [];
    }
  }

  public addHistory(city: City): void {
    try {
      let hist = this.getHistory();
      // Remove city if already in history to move it to the top
      hist = hist.filter(
        c => !(c.latitude.toFixed(4) === city.latitude.toFixed(4) && c.longitude.toFixed(4) === city.longitude.toFixed(4))
      );
      hist.unshift(city);
      // Limit history to last 10 entries
      if (hist.length > 10) {
        hist = hist.slice(0, 10);
      }
      localStorage.setItem(this.getUserKey('history'), JSON.stringify(hist));
    } catch (e) {
      console.error('Error adding history', e);
    }
  }

  public clearHistory(): void {
    try {
      localStorage.removeItem(this.getUserKey('history'));
    } catch (e) {
      console.error('Error clearing history', e);
    }
  }
}
