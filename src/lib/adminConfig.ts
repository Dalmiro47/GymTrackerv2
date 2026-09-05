// The single owner account: exempt from every daily quota and the only user
// who can open /admin. Hardcoded on purpose — this is a 1-5 user app and a UID
// is not a secret, so an env var would only add a way to get it wrong.
//
// This value is duplicated in `firestore.rules` (isAdmin()). Change both, and
// remember the rules need `firebase deploy --only firestore:rules` — a gated
// operation, see CLAUDE.md.
export const ADMIN_UID = 'FKFGGYRAt0gJqbd2yhkGsurz80C3';

export const isAdminUid = (uid?: string | null): boolean => !!uid && uid === ADMIN_UID;
