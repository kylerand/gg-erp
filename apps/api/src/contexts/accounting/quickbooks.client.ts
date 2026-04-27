/**
 * QuickBooks Online OAuth2 + REST API client.
 *
 * Required env vars (injected via Lambda environment / Secrets Manager):
 *   QB_CLIENT_ID        — QB app client ID
 *   QB_CLIENT_SECRET    — QB app client secret
 *   QB_REDIRECT_URI     — OAuth redirect URI (must match QB app settings)
 *   QB_REALM_ID         — QB company ID (stored after first OAuth, optional at init)
 *   QB_ACCESS_TOKEN     — Current access token (from Secrets Manager at runtime)
 *   QB_REFRESH_TOKEN    — Current refresh token (from Secrets Manager at runtime)
 *
 * Token storage: tokens are kept in AWS Secrets Manager at /gg-erp/{env}/qb/tokens
 * The Lambda execution role must have secretsmanager:GetSecretValue and PutSecretValue.
 */

const QB_BASE = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QB_SCOPES = 'com.intuit.quickbooks.accounting';

export interface QbTokens {
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: number; // epoch ms
}

// ─── Build authorization redirect URL ────────────────────────────────────────

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID ?? '',
    response_type: 'code',
    scope: QB_SCOPES,
    redirect_uri: process.env.QB_REDIRECT_URI ?? '',
    state,
  });
  return `${QB_BASE}?${params}`;
}

// ─── Exchange authorization code for tokens ───────────────────────────────────

export async function exchangeCodeForTokens(code: string, realmId: string): Promise<QbTokens> {
  const clientId = process.env.QB_CLIENT_ID ?? '';
  const clientSecret = process.env.QB_CLIENT_SECRET ?? '';
  const redirectUri = process.env.QB_REDIRECT_URI ?? '';

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB token exchange failed ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ─── Refresh access token ─────────────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<QbTokens & { realmId: string }> {
  const clientId = process.env.QB_CLIENT_ID ?? '';
  const clientSecret = process.env.QB_CLIENT_SECRET ?? '';
  const realmId = process.env.QB_REALM_ID ?? '';

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB token refresh failed ${res.status}: ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    realmId,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// ─── QB REST API client ───────────────────────────────────────────────────────

export class QuickBooksClient {
  constructor(private readonly tokens: QbTokens) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Some paths already carry their own query string (e.g. `/query?query=...`)
    // — in that case append the minorversion as an `&` so we don't end up with
    // two `?`s in the URL, which QB silently folds into the query parameter
    // value and rejects with a lexical-error 400.
    const sep = path.includes('?') ? '&' : '?';
    const url = `${QB_API_BASE}/${this.tokens.realmId}${path}${sep}minorversion=65`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) throw new Error('QB_UNAUTHORIZED: access token expired or invalid');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QB API error ${res.status} on ${method} ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Create an invoice in QB. Returns the QB invoice ID. */
  async createInvoice(params: {
    customerRef: string;
    lines: Array<{ description: string; amount: number; quantity: number; unitPrice: number }>;
    docNumber: string;
    dueDate?: string;
  }): Promise<{ qbInvoiceId: string; docNumber: string }> {
    const body = {
      DocNumber: params.docNumber,
      CustomerRef: { value: params.customerRef },
      DueDate: params.dueDate,
      Line: params.lines.map((l, i) => ({
        Id: String(i + 1),
        LineNum: i + 1,
        Description: l.description,
        Amount: l.amount,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          Qty: l.quantity,
          UnitPrice: l.unitPrice,
        },
      })),
    };

    const data = await this.request<{ Invoice: { Id: string; DocNumber: string } }>(
      'POST', '/invoice', body
    );
    return { qbInvoiceId: data.Invoice.Id, docNumber: data.Invoice.DocNumber };
  }

  /** Query QB for a customer by display name. */
  async findCustomer(displayName: string): Promise<{ id: string } | null> {
    const query = `SELECT Id FROM Customer WHERE DisplayName = '${displayName.replace(/'/g, "\\'")}'`;
    const data = await this.request<{ QueryResponse: { Customer?: Array<{ Id: string }> } }>(
      'GET', `/query?query=${encodeURIComponent(query)}`
    );
    return data.QueryResponse.Customer?.[0] ? { id: data.QueryResponse.Customer[0].Id } : null;
  }

  /** Create a customer in QB. Returns QB customer ID. */
  async createCustomer(displayName: string, email?: string): Promise<{ qbCustomerId: string }> {
    const body: Record<string, unknown> = { DisplayName: displayName };
    if (email) body['PrimaryEmailAddr'] = { Address: email };
    const data = await this.request<{ Customer: { Id: string } }>('POST', '/customer', body);
    return { qbCustomerId: data.Customer.Id };
  }

  /** Get company info to verify connection. */
  async getCompanyInfo(): Promise<{ companyName: string; realmId: string }> {
    const data = await this.request<{ CompanyInfo: { CompanyName: string; Id: string } }>(
      'GET', `/companyinfo/${this.tokens.realmId}`
    );
    return { companyName: data.CompanyInfo.CompanyName, realmId: data.CompanyInfo.Id };
  }

  /**
   * Total customer count in the QB company. QBO doesn't support COUNT(*)
   * cleanly — request 1 row and read `maxResults` / `totalCount` from
   * the response metadata. Falls back to the returned items length if
   * neither is present.
   */
  async countCustomers(): Promise<number> {
    const data = await this.request<{
      QueryResponse: {
        Customer?: unknown[];
        maxResults?: number;
        totalCount?: number;
      };
    }>(
      'GET',
      `/query?query=${encodeURIComponent('SELECT Id FROM Customer MAXRESULTS 1000')}`,
    );
    if (typeof data.QueryResponse.totalCount === 'number') return data.QueryResponse.totalCount;
    return data.QueryResponse.Customer?.length ?? 0;
  }

  /** Recent invoices ordered by metadata create time, newest first. */
  async listRecentInvoices(limit = 5): Promise<QbInvoiceSummary[]> {
    const cap = Math.min(Math.max(limit, 1), 50);
    const data = await this.request<{ QueryResponse: { Invoice?: QbInvoiceRaw[] } }>(
      'GET',
      `/query?query=${encodeURIComponent(
        `SELECT Id, DocNumber, TotalAmt, Balance, TxnDate, DueDate, CustomerRef FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS ${cap}`,
      )}`,
    );
    return (data.QueryResponse.Invoice ?? []).map((i) => ({
      id: i.Id,
      docNumber: i.DocNumber,
      totalAmount: i.TotalAmt,
      balance: i.Balance,
      txnDate: i.TxnDate,
      dueDate: i.DueDate,
      customerName: i.CustomerRef?.name,
    }));
  }

  /**
   * Sum of open invoice balances + count. Cheap proxy for AR; real QB AR
   * aging is a richer report endpoint we can wire later if needed.
   */
  async getOpenInvoicesSummary(): Promise<{ openCount: number; openBalance: number }> {
    // QB's COUNT can't combine with SUM in a single query; one round trip
    // for sum with a generous max-results, then count via length.
    const data = await this.request<{ QueryResponse: { Invoice?: Array<{ Balance: number }> } }>(
      'GET',
      `/query?query=${encodeURIComponent('SELECT Balance FROM Invoice WHERE Balance > \'0\' MAXRESULTS 1000')}`,
    );
    const items = data.QueryResponse.Invoice ?? [];
    const openBalance = items.reduce((s, i) => s + (i.Balance ?? 0), 0);
    return { openCount: items.length, openBalance };
  }

  /** Full chart of accounts with type breakdown. */
  async listAccounts(): Promise<QbAccountSummary[]> {
    const data = await this.request<{ QueryResponse: { Account?: QbAccountRaw[] } }>(
      'GET',
      `/query?query=${encodeURIComponent('SELECT Id, Name, AccountType, AccountSubType, Active FROM Account MAXRESULTS 200')}`,
    );
    return (data.QueryResponse.Account ?? []).map((a) => ({
      id: a.Id,
      name: a.Name,
      accountType: a.AccountType,
      accountSubType: a.AccountSubType,
      active: a.Active ?? true,
    }));
  }

  /** Fetch a payment by QB payment ID. */
  async getPayment(paymentId: string): Promise<QbPaymentDetails> {
    const data = await this.request<{ Payment: QbPaymentRaw }>(
      'GET', `/payment/${paymentId}`,
    );
    const p = data.Payment;

    let linkedInvoiceId: string | undefined;
    for (const line of p.Line ?? []) {
      const invoiceLink = line.LinkedTxn?.find(
        (t: { TxnType: string }) => t.TxnType === 'Invoice',
      );
      if (invoiceLink) {
        linkedInvoiceId = invoiceLink.TxnId;
        break;
      }
    }

    return {
      qbPaymentId: p.Id,
      totalAmountCents: Math.round(p.TotalAmt * 100),
      paymentMethod: p.PaymentMethodRef?.name,
      txnDate: p.TxnDate,
      linkedInvoiceId,
    };
  }
}

// ─── QB Payment types ─────────────────────────────────────────────────────────

interface QbPaymentRaw {
  Id: string;
  TotalAmt: number;
  PaymentMethodRef?: { value: string; name: string };
  TxnDate: string;
  Line?: Array<{
    LinkedTxn?: Array<{ TxnId: string; TxnType: string }>;
  }>;
}

export interface QbPaymentDetails {
  qbPaymentId: string;
  totalAmountCents: number;
  paymentMethod?: string;
  txnDate: string;
  linkedInvoiceId?: string;
}

// ─── QB read-side types (exposed for the accounting overview UI) ─────────────

interface QbInvoiceRaw {
  Id: string;
  DocNumber?: string;
  TotalAmt: number;
  Balance: number;
  TxnDate?: string;
  DueDate?: string;
  CustomerRef?: { value: string; name?: string };
}

export interface QbInvoiceSummary {
  id: string;
  docNumber?: string;
  totalAmount: number;
  balance: number;
  txnDate?: string;
  dueDate?: string;
  customerName?: string;
}

interface QbAccountRaw {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType?: string;
  Active?: boolean;
}

export interface QbAccountSummary {
  id: string;
  name: string;
  accountType: string;
  accountSubType?: string;
  active: boolean;
}
