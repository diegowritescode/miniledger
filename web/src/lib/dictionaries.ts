type Dict = Record<string, string>;

const en: Dict = {
  'common.signedIn': 'Signed in',
  'common.logout': 'Log out',
  'common.language': 'Language',
  'common.cancel': 'Cancel',
  'common.apiDocs': 'API docs',

  'brand.suffix': 'Dashboard',

  'nav.overview': 'Overview',
  'nav.accounts': 'Accounts',
  'nav.transfer': 'Transfer',
  'nav.integrity': 'Integrity',

  'errors.unavailable': 'The ledger service is unavailable. Please try again shortly.',
  'errors.invalidCredentials': 'Invalid credentials. Check the email and password and try again.',
  'errors.loginUnavailable':
    'The authorization service is unavailable. Please try again in a moment.',

  'login.title': 'Sign in to MiniLedger',
  'login.subtitle':
    'The dashboard authenticates against AccessCore. Sign in with an AccessCore account that holds the ledger operator capability.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Log in',
  'login.demoHint':
    'Uses your AccessCore identity — the same credentials as the AccessCore console.',

  'overview.title': 'Overview',
  'overview.description':
    'A double-entry ledger: money moves between accounts as balanced postings, transfers are idempotent, balances stay correct under concurrency, and every posting is chained into a tamper-evident audit trail.',
  'overview.accountsTitle': 'Accounts',
  'overview.accountsBody': 'Open accounts and watch balances move.',
  'overview.transferTitle': 'Transfer',
  'overview.transferBody': 'Move money with an idempotency key — retries never double-spend.',
  'overview.integrityTitle': 'Integrity',
  'overview.integrityBody': 'Verify the per-account hash chain and prove money is conserved.',
  'overview.open': 'Open',

  'accounts.title': 'Accounts',
  'accounts.description':
    'Your accounts and the shared system accounts. Balances are stored in minor units and shown here formatted to the currency.',
  'accounts.open': 'Open account',
  'accounts.opening': 'Opening…',
  'accounts.currency': 'Currency',
  'accounts.openTitle': 'Open an account',
  'accounts.openDescription':
    'Creates a user account you own, in the chosen currency, with a zero balance.',
  'accounts.thAccount': 'Account',
  'accounts.thType': 'Type',
  'accounts.thCurrency': 'Currency',
  'accounts.thBalance': 'Balance',
  'accounts.empty': 'No accounts yet. Open one to get started.',
  'accounts.system': 'system',
  'accounts.you': 'you',
  'accounts.loadError': 'Accounts could not be loaded from the ledger.',
};

const es: Dict = {
  'common.signedIn': 'Sesión iniciada',
  'common.logout': 'Cerrar sesión',
  'common.language': 'Idioma',
  'common.cancel': 'Cancelar',
  'common.apiDocs': 'Docs de la API',

  'brand.suffix': 'Dashboard',

  'nav.overview': 'Resumen',
  'nav.accounts': 'Cuentas',
  'nav.transfer': 'Transferir',
  'nav.integrity': 'Integridad',

  'errors.unavailable':
    'El servicio del ledger no está disponible. Intentá de nuevo en un momento.',
  'errors.invalidCredentials':
    'Credenciales inválidas. Revisá el email y la contraseña e intentá de nuevo.',
  'errors.loginUnavailable':
    'El servicio de autorización no está disponible. Intentá de nuevo en un momento.',

  'login.title': 'Iniciar sesión en MiniLedger',
  'login.subtitle':
    'El dashboard se autentica contra AccessCore. Iniciá sesión con una cuenta de AccessCore que tenga la capacidad de operador del ledger.',
  'login.email': 'Email',
  'login.password': 'Contraseña',
  'login.submit': 'Ingresar',
  'login.demoHint':
    'Usa tu identidad de AccessCore — las mismas credenciales que la consola de AccessCore.',

  'overview.title': 'Resumen',
  'overview.description':
    'Un ledger de doble entrada: el dinero se mueve entre cuentas como asientos balanceados, las transferencias son idempotentes, los balances se mantienen correctos bajo concurrencia, y cada asiento se encadena en un registro de auditoría a prueba de manipulación.',
  'overview.accountsTitle': 'Cuentas',
  'overview.accountsBody': 'Abrí cuentas y observá cómo se mueven los balances.',
  'overview.transferTitle': 'Transferir',
  'overview.transferBody':
    'Mové dinero con una idempotency key — los reintentos nunca duplican el gasto.',
  'overview.integrityTitle': 'Integridad',
  'overview.integrityBody':
    'Verificá la cadena de hashes por cuenta y probá que el dinero se conserva.',
  'overview.open': 'Abrir',

  'accounts.title': 'Cuentas',
  'accounts.description':
    'Tus cuentas y las cuentas de sistema compartidas. Los balances se guardan en unidades menores y se muestran acá formateados a la moneda.',
  'accounts.open': 'Abrir cuenta',
  'accounts.opening': 'Abriendo…',
  'accounts.currency': 'Moneda',
  'accounts.openTitle': 'Abrir una cuenta',
  'accounts.openDescription':
    'Crea una cuenta de usuario tuya, en la moneda elegida, con balance en cero.',
  'accounts.thAccount': 'Cuenta',
  'accounts.thType': 'Tipo',
  'accounts.thCurrency': 'Moneda',
  'accounts.thBalance': 'Balance',
  'accounts.empty': 'Aún no hay cuentas. Abrí una para empezar.',
  'accounts.system': 'sistema',
  'accounts.you': 'vos',
  'accounts.loadError': 'No se pudieron cargar las cuentas del ledger.',
};

export const dictionaries: { en: Dict; es: Dict } = { en, es };
