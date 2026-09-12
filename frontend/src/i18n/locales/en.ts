/**
 * English dictionary — the reference dictionary.
 *
 * Every other locale must implement `Dict` (i.e. provide exactly these
 * keys), which is enforced at compile time by the `Dict` type and at
 * runtime by `tests/i18n/translator.test.ts`.
 *
 * Values may contain `{{ name }}` placeholders resolved by `resolveTemplate`
 * (see `../translator.ts`).
 */
export const en = {
  // Shared
  'common.loading': 'Loading…',
  'common.refresh': 'Refresh',
  'common.clear': 'Clear',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',

  // Toast notifications (ToastHost / toast store)
  'toast.dismiss': 'Dismiss notification',

  // API error fallbacks (utils/api-error.ts)
  'errors.httpDetail': 'HTTP {{status}}: {{detail}}',
  'errors.network': 'Network connection failed. Check your network and try again.',
  'errors.validation': 'The response data was malformed. Please try again later.',
  'errors.unexpectedStatus': 'Unexpected status {{status}}',
  'errors.unexpected': 'Something went wrong. Please try again.',
  'errors.unknown': 'Unknown error',

  // Backend `detail` -> message (utils/api-error.ts)
  'errors.detail.invalidCredentials': 'Invalid credentials',
  'errors.detail.invalidRefreshToken': 'Invalid refresh token',
  'errors.detail.notAuthenticated': 'Not authenticated',
  'errors.detail.apiKeyRequired': 'API key required',
  'errors.detail.invalidApiKey': 'Invalid API key',
  'errors.detail.invalidAdminToken': 'Invalid or missing admin token',
  'errors.detail.emailNotVerified': 'Email not verified',
  'errors.detail.passwordRules': 'Password does not meet rules',
  'errors.detail.emailAlreadyRegistered': 'Email already registered',
  'errors.detail.registrationClosed': 'Registration is closed',
  'errors.detail.keyNotFound': 'Key not found',
  'errors.detail.taskNotFound': 'Task not found',

  // HTTP status fallbacks (utils/api-error.ts)
  'errors.status.400': 'Bad request. Check your input and try again.',
  'errors.status.401': 'Your session has expired. Please sign in again.',
  'errors.status.403': 'You do not have permission to perform this action.',
  'errors.status.404': 'The requested resource does not exist or has been cleaned up.',
  'errors.status.409': 'The operation conflicts with the current state. Refresh and try again.',
  'errors.status.413': 'Upload exceeds the size limit',
  'errors.status.422': 'The submitted content failed validation. Check it and try again.',
  'errors.status.429': 'Too many requests. Please try again later.',
  'errors.status.500': 'Internal server error. Please try again later.',
  'errors.status.502': 'The upstream service is temporarily unavailable. Please try again later.',
  'errors.status.503': 'The service is busy. Please try again later.',
  'errors.status.504': 'The upstream service timed out. Please try again later.',
  'errors.uploadLimitWithSize': 'Upload exceeds the size limit ({{limit}})',
  'errors.requestFailed': 'Request failed (HTTP {{status}})',

  // Client-side upload pre-check (utils/upload.ts)
  'errors.uploadOversizedFiles': 'These files exceed the {{limit}} per-upload limit: {{names}}',
  'errors.uploadOversizedTotal': 'Selected files total {{size}}, over the {{limit}} per-upload limit.',

  // Root route (__root.tsx)
  'root.notFound': '404 - Page Not Found',
  'root.goHome': 'Go Home',

  // Navigation (Sidebar, Header)
  'nav.dashboard': 'Dashboard',
  'nav.tasks': 'Tasks',
  'nav.upload': 'Upload',
  'nav.download': 'Download',
  'nav.apiKeys': 'API Keys',
  'nav.profile': 'Profile',
  'nav.adminKeys': 'Key Management',
  'nav.adminUsers': 'User Management',
  'nav.admin': 'Admin',
  'nav.taskDetail': 'Task Detail',
  'nav.logout': 'Log Out',
  'nav.language': 'Language',

  // Task statuses (StatusBadge, filters, dashboard)
  'status.pending': 'Pending',
  'status.processing': 'Processing',
  'status.retry_pending': 'Retry Pending',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',

  // MinerU backend options (upload page, task list/detail)
  'mineruBackend.label.pipeline': 'OCR recognition',
  'mineruBackend.label.vlm-engine': 'Vision model recognition',
  'mineruBackend.label.hybrid-engine': 'Hybrid recognition',

  // MinerU language options (upload page)
  'mineruLang.label.ch': 'Chinese',
  'mineruLang.label.ch_server': 'Chinese (server)',
  'mineruLang.label.korean': 'Korean',
  'mineruLang.label.ta': 'Tamil',
  'mineruLang.label.te': 'Telugu',
  'mineruLang.label.ka': 'Kannada',
  'mineruLang.label.th': 'Thai',
  'mineruLang.label.el': 'Greek',
  'mineruLang.label.arabic': 'Arabic script',
  'mineruLang.label.east_slavic': 'East Slavic',
  'mineruLang.label.cyrillic': 'Cyrillic script',
  'mineruLang.label.devanagari': 'Devanagari script',
  'mineruLang.coverage.ch': 'Chinese, English, Japanese, Traditional Chinese, Latin',
  'mineruLang.coverage.ch_server':
    'Chinese, English, Japanese, Traditional Chinese, Latin (higher accuracy / more resources)',
  'mineruLang.coverage.korean': 'Korean, English',
  'mineruLang.coverage.ta': 'Tamil, English',
  'mineruLang.coverage.te': 'Telugu, English',
  'mineruLang.coverage.ka': 'Kannada',
  'mineruLang.coverage.th': 'Thai, English',
  'mineruLang.coverage.el': 'Greek, English',
  'mineruLang.coverage.arabic':
    'Arabic, Persian, Uyghur, Urdu, Pashto, Kurdish, Sindhi, Balochi, English',
  'mineruLang.coverage.east_slavic': 'Russian, Belarusian, Ukrainian, English',
  'mineruLang.coverage.cyrillic':
    'Russian, Belarusian, Ukrainian, Serbian, Bulgarian, Mongolian, Kazakh, Kyrgyz, Tajik and 30+ other Cyrillic-script languages, English',
  'mineruLang.coverage.devanagari':
    'Hindi, Marathi, Nepali, Bihari, Maithili, Sanskrit and 14 other Devanagari-script languages, English',

  // Upload page
  'upload.fileSection': 'Files',
  'upload.filePicker': 'Click to choose files (multi-select)',
  'upload.submitted': 'Task submitted',
  'upload.taskIdLabel': 'Task ID:',
  'upload.fileCount': '({{count}} files)',
  'upload.viewDetail': 'View task detail →',
  'upload.optionsSection': 'Parse Options',
  'upload.backend': 'Backend',
  'upload.parseMethod': 'Parse Method',
  'upload.effort': 'Effort',
  'upload.language': 'Languages (multi-select)',
  'upload.langTableOption': 'Option',
  'upload.langTableCoverage': 'Covered Languages',
  'upload.formula': 'Formula recognition',
  'upload.table': 'Table recognition',
  'upload.imageAnalysis': 'Image analysis',
  'upload.zipDownload': 'Download as Zip',
  'upload.submit': 'Submit task ({{count}} files)',
  'upload.sizeSummary': '{{count}} files · {{size}} / limit {{limit}}',
  'upload.submitting': 'Submitting…',
  'upload.errNoFile': 'Choose at least one file to parse',

  // Task list
  'tasks.filterStatus': 'Status',
  'tasks.filterAll': 'All',
  'tasks.filterFileName': 'File name',
  'tasks.searchPlaceholder': 'Search by file name',
  'tasks.search': 'Search',
  'tasks.batchCancel': 'Batch cancel ({{count}})',
  'tasks.empty': 'No tasks match the filters.',
  'tasks.thTaskId': 'Task ID',
  'tasks.thStatus': 'Status',
  'tasks.thBackend': 'Backend',
  'tasks.thFiles': 'Files',
  'tasks.thCreatedAt': 'Created At',
  'tasks.thRetries': 'Retries',
  'tasks.thActions': 'Actions',
  'tasks.cancel': 'Cancel',
  'tasks.confirmCancel': 'Cancel task …{{shortId}}?',
  'tasks.confirmBatchCancel': 'Batch cancel the {{count}} selected tasks?',
  'tasks.batchResult': 'Cancelled {{cancelled}}, {{failed}} failed',

  // Task list confirmations / toasts
  'tasks.confirmCancelTitle': 'Cancel Task',
  'tasks.confirmBatchCancelTitle': 'Batch Cancel Tasks',
  'tasks.confirmBatchCancelText': 'Batch Cancel',
  'tasks.autoRefreshHint': 'In-flight tasks refresh automatically',
  'tasks.cancelledToast': 'Task cancelled',
  'tasks.batchCancelToast': 'Cancelled {{count}} task(s)',

  // Task detail
  'taskDetail.back': 'Back to tasks',
  'taskDetail.title': 'Task',
  'taskDetail.backend': 'Backend',
  'taskDetail.fileCount': 'Files',
  'taskDetail.retries': 'Retries',
  'taskDetail.createdAt': 'Created At',
  'taskDetail.startedAt': 'Started At',
  'taskDetail.completedAt': 'Completed At',
  'taskDetail.elapsed': 'Elapsed',
  'taskDetail.queuedAhead': 'Tasks Queued Ahead',
  'taskDetail.fileList': 'Files',
  'taskDetail.error': 'Error',
  'taskDetail.cancel': 'Cancel Task',
  'taskDetail.download': 'Download Result',
  'taskDetail.confirmCancel': 'Cancel this task?',
  'taskDetail.partialResultHint': 'The task failed. You can try downloading partial results.',

  // Result download page
  'download.description':
    'All downloadable tasks are listed here (including partial results of failed tasks). Download them one by one, or select several and download them as a ZIP.',
  'download.pack': 'Download ZIP ({{count}})',
  'download.empty': 'No tasks with downloadable results yet.',
  'download.thTaskId': 'Task ID',
  'download.thFiles': 'Files',
  'download.thStatus': 'Status',
  'download.thCompletedAt': 'Completed At',
  'download.thActions': 'Actions',
  'download.one': 'Download',
  'download.notDownloadable':
    'Some tasks cannot be downloaded: {{failed}}. Deselect them and retry.',
  'download.unknownReason': 'unknown reason',

  // API key table (shared by /api-keys and /admin/keys)
  'keyTable.prefix': 'Prefix',
  'keyTable.label': 'Label',
  'keyTable.createdAt': 'Created At',
  'keyTable.lastUsed': 'Last Used',
  'keyTable.expiresAt': 'Expires At',
  'keyTable.status': 'Status',
  'keyTable.actions': 'Actions',
  'keyTable.inUse': 'In Use',
  'keyTable.valid': 'Active',
  'keyTable.revoked': 'Revoked',
  'keyTable.revoke': 'Revoke',
  'keyTable.confirmRevoke': 'Revoke key "{{name}}"? This action cannot be undone.',
  'keyTable.revokeTitle': 'Revoke API Key',
  'keyTable.revokedToast': 'API key revoked',

  // API keys page
  'apiKeys.createTitle': 'Create New Key',
  'apiKeys.label': 'Label (optional)',
  'apiKeys.labelPlaceholder': 'e.g. laptop',
  'apiKeys.expiresAt': 'Expires At (optional)',
  'apiKeys.creating': 'Creating…',
  'apiKeys.create': 'Create',
  'apiKeys.listTitle': 'My Keys',
  'apiKeys.empty': 'No API keys yet. Create one to get started.',
  'apiKeys.errUnverified':
    'Your email is not verified. Verify your email before creating an API key.',
  'apiKeys.activeKeyTitle': 'Active Key',
  'apiKeys.activeKeyDesc':
    'Task endpoints (list, upload, download) are authenticated with an API key. After creating a key you can use it in this browser with one click, or paste an existing key.',
  'apiKeys.notSet': 'Not set. Task pages will not be able to load data.',
  'apiKeys.manualTitle': 'Manually Set an Existing Key',
  'apiKeys.pastePlaceholder': 'Paste the full API key',
  'apiKeys.set': 'Set',
  'apiKeys.createdToast': 'API key created',

  // NoActiveKey placeholder
  'noActiveKey.title': 'API Key Required',
  'noActiveKey.description':
    'Task endpoints are authenticated with an API key. Create a key on the API Keys page and use it in this browser, or paste an existing key.',
  'noActiveKey.goTo': 'Go to API Keys',

  // One-time key reveal
  'apiKeyReveal.title': 'Key created — save it now, the full key is shown only once',
  'apiKeyReveal.copied': 'Copied',
  'apiKeyReveal.copy': 'Copy',
  'apiKeyReveal.useHere': 'Use this key in this browser',

  // Admin token gate
  'adminGate.title': 'Admin Token Required',
  'adminGate.description':
    'Admin endpoints are authenticated with the gateway admin token (GATEWAY_ADMIN_TOKEN), which is stored in this tab only.',
  'adminGate.tokenLabel': 'Admin Token',
  'adminGate.submit': 'Submit',
  'adminGate.setNotice': 'Admin token set (this tab only)',

  // Admin: keys
  'adminKeys.issueTitle': 'Issue New Key',
  'adminKeys.label': 'Label (optional)',
  'adminKeys.expiresAt': 'Expires At (optional)',
  'adminKeys.issuing': 'Issuing…',
  'adminKeys.issue': 'Issue',
  'adminKeys.listTitle': 'All Keys',
  'adminKeys.empty': 'No API keys yet.',
  'adminKeys.issuedToast': 'API key issued',

  // Admin: users
  'adminUsers.createdTitle': 'User Created',
  'adminUsers.nameSuffix': ' ({{name}})',
  'adminUsers.superuserTag': ' · Admin',
  'adminUsers.createTitle': 'Create User',
  'adminUsers.email': 'Email',
  'adminUsers.initialPassword': 'Initial Password',
  'adminUsers.displayName': 'Display Name (optional)',
  'adminUsers.superuser': 'Admin',
  'adminUsers.creating': 'Creating…',
  'adminUsers.submit': 'Create User',

  // Pagination
  'pagination.prev': 'Previous',
  'pagination.next': 'Next',
  'pagination.info': 'Page {{page}} of {{totalPages}} · {{total}} items',

  // Profile
  'profile.accountInfo': 'Account',
  'profile.email': 'Email',
  'profile.role': 'Role',
  'profile.roleAdmin': 'Admin',
  'profile.roleUser': 'User',
  'profile.emailVerification': 'Email Verification',
  'profile.verified': 'Verified',
  'profile.unverified': 'Unverified',
  'profile.registeredAt': 'Registered At',
  'profile.editTitle': 'Edit Profile',
  'profile.displayName': 'Display Name',
  'profile.newPassword': 'New Password (leave blank to keep current)',
  'profile.confirmNewPassword': 'Confirm New Password',
  'profile.saving': 'Saving…',
  'profile.save': 'Save',
  'profile.saved': 'Saved',
  'profile.errPasswordMismatch': 'Passwords do not match',
  'profile.errNoChanges': 'Nothing to save',

  // Login
  'login.title': 'Sign In',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign In',
  'login.submitting': 'Signing In…',
  'login.oauthDivider': 'Third-party Login',
  'login.oauthButton': 'Sign in with {{provider}}',
  'login.noAccount': 'No account yet?',
  'login.toRegister': 'Register',

  // Register
  'register.title': 'Register',
  'register.email': 'Email',
  'register.displayName': 'Display Name (optional)',
  'register.password': 'Password',
  'register.confirmPassword': 'Confirm Password',
  'register.submit': 'Register',
  'register.submitting': 'Registering…',
  'register.errPasswordMismatch': 'Passwords do not match',
  'register.hasAccount': 'Already have an account?',
  'register.toLogin': 'Sign In',
  'register.successTitle': 'Registration Successful',
  'register.successPrefix': 'A verification email has been sent to ',
  'register.successSuffix':
    '. Please check your inbox and click the verification link to verify your email, then sign in.',
  'register.goLogin': 'Sign In',

  // OAuth callback / email verification landing
  'oauth.completing': 'Completing sign-in…',
  'oauth.failedTitle': 'Sign-In Failed',
  'oauth.backToLogin': 'Back to Sign In',
  'oauth.errMissingTokens': 'Sign-in callback is missing token parameters. Please try again.',
  'oauth.errLoginFailed': 'Sign-in failed. Please try again.',
  'oauth.verifyFailedTitle': 'Email Verification Failed',
  'oauth.verifyFailedBody':
    'The verification link is invalid or has expired. Please request a new verification email.',
  'oauth.verifySuccessTitle': 'Email Verified',
  'oauth.verifySuccessBody': 'Your email is now verified. You can create an API key.',
  'oauth.goLogin': 'Sign In',
  'oauth.goHome': 'Go Home',

  // Email verification dialog
  'emailVerification.title': 'Email Verification',
  'emailVerification.body':
    'Your email is not verified yet. You must verify your email before creating an API key. A verification email has been sent to your address — please check your inbox and click the verification link. If it did not arrive, use the button below to resend it.',
  'emailVerification.sent': 'Verification email sent. Please check your inbox.',
  'emailVerification.send': 'Send Verification Email',
  'emailVerification.resend': 'Resend Verification Email',
  'emailVerification.sending': 'Sending…',
  'emailVerification.check': 'I have verified — refresh status',
  'emailVerification.checking': 'Checking…',
  'emailVerification.errNotVerified':
    'Not verified yet. Click the verification link in the email and try again.',

  // Dashboard
  'dashboard.welcome': 'Welcome, {{name}}',
  'dashboard.statusSection': 'Task Status',
  'dashboard.overviewSection': 'Overview',
  'dashboard.todayCompleted': 'Completed Today',
  'dashboard.todayFailed': 'Failed Today',
  'dashboard.totalBytes': 'Total Data Processed',
  'dashboard.avgDuration': 'Average Duration',
  'dashboard.footerPrefix': 'See the',
  'dashboard.tasksLink': 'task list',
  'dashboard.footerSuffix': ' for details on each task.',

  // Duration units (utils/format.ts)
  'format.hourShort': '{{n}}h',
  'format.minuteShort': '{{n}}m',
  'format.secondShort': '{{n}}s',
} as const;

/** Every dictionary key (literal union derived from the reference dict). */
export type DictKey = keyof typeof en;

/** Shape every locale dictionary must implement. */
export type Dict = Record<DictKey, string>;
