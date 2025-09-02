import { Injectable } from '@angular/core';
import { Router, CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
    providedIn: 'root'
})
export class AuthGuard implements CanActivate {
    constructor(
        private router: Router,
        private authService: AuthService
    ) {}

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {
        const currentUser = this.authService.currentUserValue;
        if (currentUser) {
            // Check if route is restricted by role
            if (route.data['roles'] && !route.data['roles'].some((role: string) => 
                currentUser.roles.includes(role))) {
                // Role not authorized
                this.router.navigate(['/dashboard']);
                return false;
            }
            return true;
        }

        // Not logged in
        this.router.navigate(['/login']);
        return false;
    }
}