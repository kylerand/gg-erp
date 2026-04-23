/**
 * Cognito PreSignUp trigger.
 *
 * Fires whenever a user is created — either from hosted-UI sign-up, admin
 * create, or (the case we care about here) a federated identity provider
 * on their first login. We enforce that any externally-federated sign-up
 * comes from the `@golfingarage.com` Google Workspace domain.
 *
 * This is belt-and-suspenders on top of Google's `hd=` param: if the Google
 * OAuth client is ever misconfigured to allow other Workspaces, Cognito
 * still refuses to create the user.
 */

type TriggerSource =
  | 'PreSignUp_SignUp'
  | 'PreSignUp_AdminCreateUser'
  | 'PreSignUp_ExternalProvider';

type PreSignUpEvent = {
  triggerSource: TriggerSource;
  request: {
    userAttributes: Record<string, string>;
  };
  response: {
    autoConfirmUser?: boolean;
    autoVerifyEmail?: boolean;
    autoVerifyPhone?: boolean;
  };
};

const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN ?? 'golfingarage.com').toLowerCase();

export async function handler(event: PreSignUpEvent): Promise<PreSignUpEvent> {
  const email = (event.request.userAttributes.email ?? '').toLowerCase().trim();

  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    if (!email) {
      throw new Error('External identity provider did not return an email attribute.');
    }
    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      throw new Error(`Sign-in is restricted to @${ALLOWED_DOMAIN} accounts.`);
    }
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  // For admin-created users and native sign-ups we do not enforce the
  // domain here — the pool may still contain service accounts like
  // krand40@gmail.com that were seeded before SSO was enabled.

  return event;
}
