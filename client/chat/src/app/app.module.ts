// src/app/app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';

// ✅ These are STANDALONE components
import { AppComponent } from './app.component';
import { LoginComponent } from './components/login/login.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { ChatComponent } from './components/chat/chat.component';
import { AdminComponent } from './components/admin/admin.component';
import { GroupAdminComponent } from './components/group-admin/group-admin.component';

@NgModule({
  declarations: [],

  // Import standalone components here
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,

    AppComponent,
    LoginComponent,
    DashboardComponent,
    ChatComponent,
    AdminComponent,
    GroupAdminComponent,
  ],

  bootstrap: [AppComponent],
})
export class AppModule {}
