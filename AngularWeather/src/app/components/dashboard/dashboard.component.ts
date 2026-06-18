import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';
import { City, WeatherData, WeatherService } from '../../services/weather.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
  standalone: false
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly weatherService = inject(WeatherService);
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);

  // Re-exposing signals for template
  public readonly currentUser = this.authService.currentUser;
  public readonly weatherAlerts = this.notificationService.alerts;
  public readonly permissionGranted = this.notificationService.permissionGranted;

  // Local state signals
  public readonly weatherData = signal<WeatherData | null>(null);
  public readonly searchResults = signal<City[]>([]);
  public readonly searchHistory = signal<City[]>([]);
  public readonly favoriteCities = signal<City[]>([]);
  public readonly searchInput = signal<string>('');
  
  public readonly isSearching = signal<boolean>(false);
  public readonly isLoadingWeather = signal<boolean>(false);
  public readonly weatherError = signal<string>('');
  public readonly isOnline = signal<boolean>(navigator.onLine);
  
  // UI Panels state
  public readonly showSuggestions = signal<boolean>(false);
  public readonly showHistory = signal<boolean>(false);
  public readonly showNotificationsPanel = signal<boolean>(false);

  private readonly searchSubject = new Subject<string>();
  private searchSubscription?: Subscription;

  public ngOnInit(): void {
    // 1. Verify Authentication
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    // 2. Setup Debounced Geocoding Search
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      switchMap(query => {
        if (query.trim().length < 2) {
          return [];
        }
        this.isSearching.set(true);
        return this.weatherService.searchCity(query);
      })
    ).subscribe({
      next: (results) => {
        this.searchResults.set(results);
        this.isSearching.set(false);
        this.showSuggestions.set(results.length > 0);
      },
      error: (err) => {
        console.error(err);
        this.isSearching.set(false);
      }
    });

    // 3. Load Offline/Online Browser State
    window.addEventListener('online', this.updateOnlineStatus);
    window.addEventListener('offline', this.updateOnlineStatus);

    // 4. Load initial user favorites and history
    this.loadHistoryAndFavorites();

    // 5. Load Initial Weather:
    // Try last searched city first, otherwise try GPS, otherwise fallback to São Paulo
    const lastSearched = this.weatherService.getLastSearchedCity();
    if (lastSearched) {
      this.fetchWeather(lastSearched);
    } else {
      this.loadWeatherByGPS(true); // silent = true so if it fails/denies it falls back to São Paulo without an error alert
    }
  }

  public ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
    }
    window.removeEventListener('online', this.updateOnlineStatus);
    window.removeEventListener('offline', this.updateOnlineStatus);
  }

  private updateOnlineStatus = (): void => {
    this.isOnline.set(navigator.onLine);
  };

  private loadHistoryAndFavorites(): void {
    this.searchHistory.set(this.weatherService.getHistory());
    this.favoriteCities.set(this.weatherService.getFavorites());
  }

  // Handle keyup in search field
  public onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchInput.set(value);
    
    if (value.trim().length === 0) {
      this.searchResults.set([]);
      this.showSuggestions.set(false);
    } else {
      this.searchSubject.next(value);
    }
  }

  // Request notifications permission
  public async requestNotificationPermission(): Promise<void> {
    const granted = await this.notificationService.requestPermissions();
    if (granted) {
      this.notificationService.triggerNotification(
        'Permissão Concedida! 🔔',
        'Agora você receberá alertas sobre condições climáticas severas.',
        'info'
      );
    }
  }

  // Fetch weather for a selected city
  public fetchWeather(city: City): void {
    this.isLoadingWeather.set(true);
    this.weatherError.set('');
    this.showSuggestions.set(false);
    this.showHistory.set(false);

    this.weatherService.getWeather(city).subscribe({
      next: (data) => {
        this.weatherData.set(data);
        this.isLoadingWeather.set(false);
        
        // Add to history list
        this.weatherService.addHistory(city);
        this.loadHistoryAndFavorites();
        
        // Run notification alert analyzer
        this.notificationService.analyzeWeatherForAlerts(data);
      },
      error: (err) => {
        this.isLoadingWeather.set(false);
        this.weatherError.set(err.message || 'Erro ao carregar dados meteorológicos.');
      }
    });
  }

  // Trigger GPS coordinate fetch
  public loadWeatherByGPS(silent: boolean = false): void {
    this.isLoadingWeather.set(true);
    this.weatherError.set('');

    this.weatherService.getWeatherByGPS().subscribe({
      next: (data) => {
        this.weatherData.set(data);
        this.isLoadingWeather.set(false);
        this.weatherService.addHistory(data.city);
        this.loadHistoryAndFavorites();
        this.notificationService.analyzeWeatherForAlerts(data);
      },
      error: (err) => {
        this.isLoadingWeather.set(false);
        if (silent) {
          // Fallback city: São Paulo, Brasil
          const sp: City = {
            name: 'São Paulo',
            latitude: -23.5489,
            longitude: -46.6388,
            country: 'Brasil',
            admin1: 'São Paulo'
          };
          this.fetchWeather(sp);
        } else {
          this.weatherError.set('Não foi possível obter sua localização via GPS. Verifique as permissões de localização do seu navegador.');
        }
      }
    });
  }

  // Toggle favorite city status
  public toggleFavorite(event: Event): void {
    event.stopPropagation();
    const data = this.weatherData();
    if (!data) return;

    if (this.isFavorite()) {
      this.weatherService.removeFavorite(data.city);
    } else {
      this.weatherService.addFavorite(data.city);
    }
    this.loadHistoryAndFavorites();
  }

  public isFavorite(): boolean {
    const data = this.weatherData();
    return data ? this.weatherService.isFavorite(data.city) : false;
  }

  public clearSearchHistory(event: Event): void {
    event.stopPropagation();
    this.weatherService.clearHistory();
    this.loadHistoryAndFavorites();
  }

  // Simulate Extreme Alerts
  public simulateStorm(): void {
    const data = this.weatherData();
    const city = data ? data.city.name : 'Sua Cidade';
    this.notificationService.triggerNotification(
      `Alerta de Tempestade em ${city}! ⛈️`,
      'SIMULAÇÃO: Tempestade severa com risco de alagamentos e ventos fortes. Procure abrigo seguro.',
      'danger'
    );
  }

  public simulateHeatwave(): void {
    const data = this.weatherData();
    const city = data ? data.city.name : 'Sua Cidade';
    this.notificationService.triggerNotification(
      `Onda de Calor Extremo em ${city}! ☀️`,
      'SIMULAÇÃO: Temperaturas ultrapassando os 38°C nas próximas horas. Mantenha-se hidratado e evite esforço físico.',
      'danger'
    );
  }

  public simulateCold(): void {
    const data = this.weatherData();
    const city = data ? data.city.name : 'Sua Cidade';
    this.notificationService.triggerNotification(
      `Alerta de Geada / Frio Extremo em ${city}! ❄️`,
      'SIMULAÇÃO: Queda brusca de temperatura para 2°C com geada ao amanhecer. Proteja plantas e animais.',
      'warning'
    );
  }

  public removeAlert(id: string, event: Event): void {
    event.stopPropagation();
    this.notificationService.removeAlert(id);
  }

  public clearAlerts(event: Event): void {
    event.stopPropagation();
    this.notificationService.clearAlerts();
  }

  public toggleNotificationsPanel(): void {
    this.showNotificationsPanel.update(v => !v);
  }

  public logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
