import { Injectable, signal } from '@angular/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { WeatherData } from './weather.service';

export interface WeatherAlert {
  id: string;
  title: string;
  message: string;
  type: 'danger' | 'warning' | 'info';
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private readonly alertsSignal = signal<WeatherAlert[]>([]);
  public readonly alerts = this.alertsSignal.asReadonly();
  
  private readonly permissionGrantedSignal = signal<boolean>(false);
  public readonly permissionGranted = this.permissionGrantedSignal.asReadonly();

  constructor() {
    this.checkPermissionStatus();
  }

  private async checkPermissionStatus(): Promise<void> {
    try {
      if ('Notification' in window) {
        this.permissionGrantedSignal.set(Notification.permission === 'granted');
      }
    } catch (e) {
      console.warn('Web notification check failed', e);
    }
  }

  // Request notification permissions (Capacitor and Web Browser fallback)
  public async requestPermissions(): Promise<boolean> {
    // 1. Try Capacitor Push Notifications
    try {
      const result = await PushNotifications.requestPermissions();
      if (result.receive === 'granted') {
        this.permissionGrantedSignal.set(true);
        return true;
      }
    } catch (e) {
      console.warn('Capacitor Push Notifications not available on web, using standard Notification API.', e);
    }

    // 2. Fallback to standard web notification API
    if ('Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        const granted = permission === 'granted';
        this.permissionGrantedSignal.set(granted);
        return granted;
      } catch (e) {
        console.error('Failed to request web notification permission', e);
      }
    }
    
    return false;
  }

  // Trigger a system notification if permissions are granted, and add to in-app alerts list
  public triggerNotification(title: string, body: string, type: 'danger' | 'warning' | 'info' = 'info'): void {
    const alert: WeatherAlert = {
      id: Math.random().toString(36).substring(2, 9),
      title,
      message: body,
      type,
      timestamp: Date.now()
    };

    // Add alert to local reactive signal list
    this.alertsSignal.update(alerts => [alert, ...alerts]);

    // Show system notification if granted
    if (this.permissionGranted()) {
      try {
        // Fallback to web browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/assets/icons/weather-alert.png' // Fallback icon
          });
        }
      } catch (e) {
        console.warn('Could not display browser notification:', e);
      }
    }
  }

  // Analyze weather data and automatically push alerts for severe conditions
  public analyzeWeatherForAlerts(weather: WeatherData): void {
    const temp = weather.current.temperature;
    const code = weather.current.weatherCode;
    const cityName = weather.city.name;

    // Check for Heatwave
    if (temp >= 35) {
      this.triggerNotification(
        `Alerta de Calor em ${cityName}! ☀️`,
        `Temperatura muito elevada registrada: ${temp.toFixed(1)}°C. Mantenha-se hidratado e evite exposição direta ao sol.`,
        'danger'
      );
    } 
    // Check for Extreme Cold
    else if (temp <= 5) {
      this.triggerNotification(
        `Alerta de Frio em ${cityName}! ❄️`,
        `Temperatura muito baixa registrada: ${temp.toFixed(1)}°C. Agasalhe-se bem e proteja-se do frio.`,
        'warning'
      );
    }

    // Check WMO weather code for Storms (Codes 95, 96, 99)
    if (code === 95 || code === 96 || code === 99) {
      this.triggerNotification(
        `Alerta de Tempestade em ${cityName}! ⛈️`,
        `Condições de tempestade severa detectadas. Evite sair de casa se possível e proteja seus equipamentos eletrônicos.`,
        'danger'
      );
    }
    // Check WMO weather code for Heavy Rain (Codes 65, 82)
    else if (code === 65 || code === 82) {
      this.triggerNotification(
        `Alerta de Chuva Forte em ${cityName}! 🌧️`,
        `Previsão de chuva torrencial. Cuidado com possíveis pontos de alagamento na região.`,
        'warning'
      );
    }
  }

  // Clear in-app notification logs
  public clearAlerts(): void {
    this.alertsSignal.set([]);
  }

  // Remove single alert
  public removeAlert(id: string): void {
    this.alertsSignal.update(alerts => alerts.filter(a => a.id !== id));
  }
}
