
import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { GroupListComponent } from './groups/group-list.component';
import { ChannelViewComponent } from './channels/channel-view.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'groups', component: GroupListComponent },
  { path: 'groups/:gid/channels/:cid', component: ChannelViewComponent },
  { path: '', pathMatch: 'full', redirectTo: 'groups' },
  { path: '**', redirectTo: 'groups' }
];