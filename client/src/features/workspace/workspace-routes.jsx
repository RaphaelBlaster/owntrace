import GmailConnectionPage from '../google/GmailConnectionPage.jsx'
import MicrosoftConnectionPage from '../microsoft/MicrosoftConnectionPage.jsx'
import MailConnectionsPage from '../mail/MailConnectionsPage.jsx'
import IdentityPage from '../identity/IdentityPage.jsx'
import AccountSettingsPage from '../settings/AccountSettingsPage.jsx'
import ExposuresPage from '../privacy/ExposuresPage.jsx'
import NotificationsPage from '../privacy/NotificationsPage.jsx'
import PrivacyRequestsPage from '../privacy/PrivacyRequestsPage.jsx'
import PrismWorkspace from './PrismWorkspace.jsx'
import OrdersPage from '../orders/OrdersPage.jsx'
import TopKPage from '../top-k/TopKPage.jsx'
import useAuth from '../auth/useAuth.js'
import { Overview, Accounts, AccountDetails, Subscriptions, Security, Actions, Connections, Report } from '../../demo/screens.jsx'

const workspaceRoutes = [
  { path: 'connect', title: 'Connections', Component: Connections, section:'connections', onboardingComponent:MailConnectionsPage },
  { path: 'connect/gmail', title: 'Gmail', Component: GmailConnectionPage },
  { path: 'connect/microsoft', title: 'Microsoft', Component: MicrosoftConnectionPage, shell: true },
  { path: 'accounts', title: 'Accounts', Component: Accounts, section:'accounts' },
  { path: 'accounts/:id', title: 'Account evidence', Component: AccountDetails, section:'account' },
  { path: 'identity', title: 'Identity map', Component: IdentityPage, shell: true },
  { path: 'account-actions', title: 'Account actions', Component: Actions, section:'actions' },
  { path: 'settings', title: 'Settings', Component: AccountSettingsPage, shell: true },
  { path: 'dashboard', title: 'Dashboard', Component: Overview, section:'dashboard' },
  { path: 'subscriptions', title: 'Subscriptions', Component: Subscriptions, section:'subscriptions' },
  { path: 'orders', title: 'Orders', Component: OrdersPage, section:'orders' },
  { path: 'top-k', title: 'Top K', Component: TopKPage, shell: true },
  { path: 'breaches', title: 'Security', Component: Security, section:'security' },
  { path: 'exposures', title: 'Exposures', Component: ExposuresPage },
  { path: 'privacy-health', title: 'Privacy health', Component: Report, section:'health' },
  { path: 'privacy-inbox', title: 'Action inbox', Component: Actions, section:'actions' },
  { path: 'privacy-requests', title: 'Privacy requests', Component: PrivacyRequestsPage },
  { path: 'notifications', title: 'Notifications', Component: NotificationsPage },
]
function WorkspaceRouteContent({ route, entityId }) {
  const {user} = useAuth()
  const Component = route.onboardingComponent && user.onboardingStatus !== "COMPLETED" ? route.onboardingComponent : route.Component
  return <PrismWorkspace section={route.section || 'support'} entityId={entityId}><Component entityId={entityId} /></PrismWorkspace>
}
// The registry is the single source for regular and embedded route content.
// oxlint-disable-next-line react/only-export-components
export { WorkspaceRouteContent, workspaceRoutes }
