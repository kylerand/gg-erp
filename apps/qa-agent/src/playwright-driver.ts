import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

/**
 * Constrained Playwright driver. Exposes only the operations the QA agent
 * is allowed to call as tools. Returns string outputs so the agent can
 * read them naturally.
 *
 * Mock-mode auth is handled by `signIn(role)` which does the same
 * `addInitScript(localStorage)` dance proven in scripts/demo/record.js.
 */

export interface DriverInit {
  baseUrl: string;
  viewport?: { width: number; height: number };
  isMobile?: boolean;
}

export class PlaywrightDriver {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private currentRole = '';

  constructor(private readonly init: DriverInit) {}

  async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: this.init.viewport ?? { width: 1440, height: 900 },
      isMobile: this.init.isMobile,
      hasTouch: this.init.isMobile,
      deviceScaleFactor: this.init.isMobile ? 3 : 2,
    });
    this.page = await this.context.newPage();
  }

  async stop(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
  }

  /** Set the mock-mode role; takes effect on next navigation. */
  async signIn(role: string): Promise<void> {
    if (!this.context) throw new Error('driver not started');
    if (this.currentRole) {
      await this.context.clearCookies();
    }
    this.currentRole = role;
    await this.context.addInitScript((r) => {
      try {
        window.localStorage.setItem('gg_erp_mock_role', r);
      } catch {
        // ignored
      }
    }, role);
  }

  async navigate(path: string): Promise<{ ok: boolean; status: number; url: string }> {
    if (!this.page) throw new Error('driver not started');
    const url = path.startsWith('http') ? path : this.init.baseUrl + path;
    const res = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    return { ok: !!res?.ok(), status: res?.status() ?? 0, url };
  }

  async click(selector: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.page) throw new Error('driver not started');
    try {
      await this.page.locator(selector).first().click({ timeout: 5_000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) };
    }
  }

  async type(selector: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.page) throw new Error('driver not started');
    try {
      await this.page.locator(selector).first().fill(text, { timeout: 5_000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.split('\n')[0] : String(err) };
    }
  }

  async wait(ms: number): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.min(ms, 10_000)));
  }

  /** Returns a base64-encoded PNG of the current viewport. */
  async screenshot(): Promise<string> {
    if (!this.page) throw new Error('driver not started');
    const buf = await this.page.screenshot({ type: 'png', fullPage: false });
    return buf.toString('base64');
  }

  /**
   * A compact accessibility snapshot — much smaller than the page HTML and
   * gives the agent a structured view of headings, buttons, links, inputs.
   */
  async readPage(): Promise<{
    url: string;
    title: string;
    headings: string[];
    buttons: string[];
    links: Array<{ text: string; href: string }>;
    inputs: Array<{ label: string; type: string; placeholder?: string }>;
    visibleText: string;
  }> {
    if (!this.page) throw new Error('driver not started');
    const url = this.page.url();
    const title = await this.page.title();

    const headings = await this.page
      .locator('h1, h2, h3')
      .allInnerTexts()
      .then((arr) => arr.map((s) => s.trim()).filter(Boolean).slice(0, 25));

    const buttons = await this.page
      .locator('button:visible')
      .allInnerTexts()
      .then((arr) => arr.map((s) => s.trim()).filter(Boolean).slice(0, 30));

    const links = await this.page.$$eval('a:visible', (anchors) =>
      anchors
        .slice(0, 40)
        .map((a) => ({
          text: (a as HTMLElement).innerText.trim().slice(0, 60),
          href: a.getAttribute('href') ?? '',
        }))
        .filter((l) => l.text && l.href),
    );

    const inputs = await this.page.$$eval('input:visible, select:visible, textarea:visible', (els) =>
      els.slice(0, 20).map((el) => {
        const type = (el as HTMLInputElement).type ?? el.tagName.toLowerCase();
        const labelEl = el.closest('label') ?? document.querySelector(`label[for="${el.id}"]`);
        const label = (labelEl as HTMLElement | null)?.innerText?.trim()?.slice(0, 60) ?? '';
        const placeholder = (el as HTMLInputElement).placeholder ?? undefined;
        return { label, type, placeholder };
      }),
    );

    // 1500-char snapshot of visible body text — caps token spend on the
    // model's read of dense pages.
    const visibleText = (await this.page.locator('body').innerText())
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);

    return { url, title, headings, buttons, links, inputs, visibleText };
  }

  /** Console errors observed since last call. */
  consoleErrors: string[] = [];

  attachConsoleSpy(): void {
    if (!this.page) throw new Error('driver not started');
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text().slice(0, 200));
    });
    this.page.on('pageerror', (err) => {
      this.consoleErrors.push(`pageerror: ${err.message.slice(0, 200)}`);
    });
  }
}
