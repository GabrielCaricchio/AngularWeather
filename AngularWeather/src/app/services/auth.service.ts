import { Injectable, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';

export interface User {
  username: string;
  name: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly currentUserSignal = signal<User | null>(null);
  
  public readonly currentUser = this.currentUserSignal.asReadonly();

  constructor() {
    this.checkSession();
  }

  // Check if a simulated JWT token exists and is valid
  public checkSession(): void {
    const token = localStorage.getItem('auth_token');
    if (token) {
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payloadStr = atob(parts[1]);
          const payload = JSON.parse(payloadStr);
          
          // Check if token has expired
          if (payload.exp && payload.exp > Date.now() / 1000) {
            this.currentUserSignal.set(payload.user);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to parse active session token', e);
      }
    }
    this.logout();
  }

  public isAuthenticated(): boolean {
    return !!this.currentUserSignal();
  }

  // Register a new user
  public register(username: string, password: string, name: string): Observable<{ success: boolean; message: string }> {
    if (!username || !password || !name) {
      return throwError(() => new Error('Todos os campos são obrigatórios.'));
    }

    const usersJson = localStorage.getItem('users') || '[]';
    const users = JSON.parse(usersJson) as any[];

    const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) {
      return throwError(() => new Error('Este nome de usuário já está cadastrado.'));
    }

    // Encrypt password using base64 for simulation
    const encryptedPassword = btoa(password);
    users.push({ username, password: encryptedPassword, name });
    localStorage.setItem('users', JSON.stringify(users));

    return of({ success: true, message: 'Usuário cadastrado com sucesso.' });
  }

  // Login a user and issue a simulated JWT
  public login(username: string, password: string): Observable<{ token: string; user: User }> {
    if (!username || !password) {
      return throwError(() => new Error('Usuário e senha são obrigatórios.'));
    }

    const usersJson = localStorage.getItem('users') || '[]';
    const users = JSON.parse(usersJson) as any[];

    const encryptedPassword = btoa(password);
    const user = users.find(
      u => u.username.toLowerCase() === username.toLowerCase() && u.password === encryptedPassword
    );

    if (!user) {
      return throwError(() => new Error('Usuário ou senha incorretos.'));
    }

    // Create simulated JWT token components
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    
    // Expires in 2 hours
    const exp = Math.floor(Date.now() / 1000) + (2 * 60 * 60);
    const payloadObj = {
      user: { username: user.username, name: user.name },
      exp
    };
    
    // UTF-8 friendly base64 encoding for payload
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(payloadObj))));
    
    // Simulated signature based on header + payload length
    const signature = btoa(`simulated-signature-for-${username}-${exp}`);

    const token = `${header}.${payload}.${signature}`;
    
    localStorage.setItem('auth_token', token);
    this.currentUserSignal.set(payloadObj.user);

    return of({ token, user: payloadObj.user });
  }

  public logout(): void {
    localStorage.removeItem('auth_token');
    this.currentUserSignal.set(null);
  }
}
