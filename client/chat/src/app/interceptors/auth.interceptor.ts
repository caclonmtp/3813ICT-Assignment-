import { HttpInterceptorFn } from '@angular/common/http';

// Adds x-user-id header from currentUser in localStorage
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  try {
    const raw = localStorage.getItem('currentUser');
    if (raw) {
      const user = JSON.parse(raw);
      if (user && user.id) {
        req = req.clone({ setHeaders: { 'x-user-id': user.id } });
      }
    }
  } catch (_) {
    // ignore
  }
  return next(req);
};

