import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class StorageService {
    
    // Persists a string value under the supplied key.
    setItem(key: string, value: string): void {
        localStorage.setItem(key, value);
    }

    // Retrieves a string value for the supplied key.
    getItem(key: string): string | null {
        return localStorage.getItem(key);
    }

    // Removes a stored value for the supplied key.
    removeItem(key: string): void {
        localStorage.removeItem(key);
    }

    // Clears all application storage entries.
    clear(): void {
        localStorage.clear();
    }
}
