import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ChatComponent } from './components/chat/chat.component';
import { AdminComponent } from './components/admin/admin.component';
import { GroupAdminComponent } from './components/group-admin/group-admin.component';
import { AuthGuard } from './guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: '/login', pathMatch: 'full' },
    { path: 'login', component: LoginComponent },
    { 
        path: 'dashboard', 
        component: DashboardComponent, 
        canActivate: [AuthGuard] 
    },
    { 
        path: 'chat/:groupId/:channelId', 
        component: ChatComponent, 
        canActivate: [AuthGuard] 
    },
    { 
        path: 'admin', 
        component: AdminComponent, 
        canActivate: [AuthGuard],
        data: { roles: ['super-admin'] }
    },
    { 
        path: 'group-admin', 
        component: GroupAdminComponent, 
        canActivate: [AuthGuard],
        data: { roles: ['group-admin', 'super-admin'] }
    }
];

@NgModule({
    imports: [RouterModule.forRoot(routes)],
    exports: [RouterModule]
})
export class AppRoutingModule { }