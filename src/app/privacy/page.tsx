import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How WebOpportunity AI handles personal data, including data from Pinterest.",
  robots: { index: true, follow: true },
};

// Operator details come from the environment so they are set per deployment, not in code.
const OPERATOR = process.env.PRIVACY_OPERATOR_NAME || "David King Design";
const CONTACT = process.env.PRIVACY_CONTACT_EMAIL || "";
const UPDATED = "16 November 2026";

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="mt-10 scroll-mt-6 text-xl font-semibold">{children}</h2>;
}

export default function PrivacyPage() {
  const contact = CONTACT ? <a href={`mailto:${CONTACT}`} className="text-primary underline">{CONTACT}</a> : <span>the operator using the contact details on its website</span>;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 text-[15px] leading-relaxed sm:px-6">
      <p className="text-sm text-muted-foreground"><Link href="/login" className="hover:underline">WebOpportunity AI</Link></p>
      <h1 className="mt-2 text-3xl font-semibold">Privacy policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

      <p className="mt-6">WebOpportunity AI is a private tool, operated by {OPERATOR}, that helps a web design agency find small businesses whose websites could be improved, research design ideas and prepare website concepts. This policy explains what personal data the service handles, why, and your rights. Questions or requests: {contact}.</p>

      <nav aria-label="Contents" className="mt-6 rounded-lg border bg-card p-4 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li><a href="#who" className="hover:underline">Who is responsible</a></li>
          <li><a href="#data" className="hover:underline">What we collect and why</a></li>
          <li><a href="#pinterest" className="hover:underline">Pinterest</a></li>
          <li><a href="#processors" className="hover:underline">Service providers</a></li>
          <li><a href="#retention" className="hover:underline">How long we keep data</a></li>
          <li><a href="#security" className="hover:underline">Security</a></li>
          <li><a href="#rights" className="hover:underline">Your rights</a></li>
          <li><a href="#cookies" className="hover:underline">Cookies</a></li>
          <li><a href="#changes" className="hover:underline">Changes</a></li>
        </ol>
      </nav>

      <H id="who">1. Who is responsible</H>
      <p>{OPERATOR} is the data controller for personal data processed by this service. The service is used only by the operator and the team members it invites; it is not offered to the public.</p>

      <H id="data">2. What we collect and why</H>
      <h3 className="mt-4 font-medium">People who use the app</h3>
      <p>Name, email address, password (stored only as a secure hash by our authentication provider), workspace membership and role, and a log of important actions (for example approvals). We use this to run accounts, control access and keep an audit trail. Legal basis: performance of a contract and legitimate interests in operating a secure service.</p>
      <h3 className="mt-4 font-medium">Businesses we research</h3>
      <p>Business names, addresses, phone numbers, website addresses, ratings and opening hours from public sources (OpenStreetMap, Google Maps results via SerpAPI or Google Places, and lists the team imports), plus measurements of the business&apos;s public website (for example whether it works on phones). We only record an email address that the business published itself. Some of this can relate to identifiable people, such as sole traders. We use it to decide which businesses might want a better website and to prepare a concept for them. Legal basis: legitimate interests in business-to-business marketing. No email is sent to a business without a person approving it, and every email includes an unsubscribe link that we honour.</p>
      <h3 className="mt-4 font-medium">Design references</h3>
      <p>Links to websites and Pinterest pins chosen as inspiration, pictures the team uploads, and notes about them. These are used only to brief the design of a concept site. We take abstract qualities such as colour and spacing; we do not copy other people&apos;s designs, images or text.</p>

      <H id="pinterest">3. Pinterest</H>
      <p>If the operator connects a Pinterest account, the service uses Pinterest&apos;s official API with that account&apos;s permission to:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>list the account&apos;s own boards, so the operator can choose which board feeds each business sector;</li>
        <li>read pins on those boards (title, description, link and image address), and, only if Pinterest has granted the access, search public pins.</li>
      </ul>
      <p className="mt-2">We store a pin&apos;s link, title, image address and the pinner&apos;s username as a reference inside the operator&apos;s private workspace. We do not download or re-host Pinterest images; they are shown from Pinterest&apos;s own servers. We do not create, edit or delete pins or boards, do not post to Pinterest, do not use Pinterest data for advertising, do not sell or share it with anyone else, and do not use it to train AI models. Pin text may be passed to our AI provider (below) only to help pick design references.</p>
      <p className="mt-2">The Pinterest access token is encrypted (AES-256-GCM) and can be read only by our server. When the operator disconnects Pinterest, we delete the token, the board assignments and every saved Pinterest reference. You can also revoke access at any time in your Pinterest account settings.</p>

      <H id="processors">4. Service providers</H>
      <p>We use these providers to run the service. Each processes data only on our instructions and under its own data protection terms:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li><strong>Supabase</strong>: database, authentication and private file storage.</li>
        <li><strong>Vercel</strong>: hosting of this application.</li>
        <li><strong>Anthropic (Claude)</strong>: AI analysis of website measurements, design references and briefs, and web search for example websites. Anthropic does not train its models on data sent through its commercial API.</li>
        <li><strong>Cloudflare</strong>: hosting of website concepts, only after a person approves publishing.</li>
        <li><strong>Resend</strong>: sending approved emails.</li>
        <li><strong>SerpAPI, Google Places, OpenStreetMap</strong>: finding public business listings.</li>
        <li><strong>Pinterest</strong>: design references, as described above.</li>
      </ul>
      <p className="mt-2">Some providers are based outside the UK and EEA. Where data is transferred, we rely on the provider&apos;s standard contractual clauses or an adequacy decision.</p>

      <H id="retention">5. How long we keep data</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Account data: while the account exists, then deleted on request.</li>
        <li>Business records: until the operator deletes them, or sooner where a data source requires it (for example, Google Places details are removed after 30 days).</li>
        <li>Pinterest references and token: until Pinterest is disconnected or the reference is removed.</li>
        <li>Unsubscribe and suppression records: kept so we never contact that address again.</li>
        <li>The audit log is append-only and kept for as long as the workspace exists.</li>
      </ul>

      <H id="security">6. Security</H>
      <p>Every table is protected by row-level security, so each workspace sees only its own data. Secrets such as API keys are encrypted at rest and never sent to the browser. Websites we look at are fetched through a guarded fetcher that refuses private network addresses. Uploads are checked by their content and stored privately. Publishing a site and sending an email always need a person&apos;s approval.</p>

      <H id="rights">7. Your rights</H>
      <p>Depending on where you live (including under UK and EU GDPR), you can ask for access to your data, correction, deletion, restriction, a copy in a portable form, or object to our use of it, including for direct marketing (we will stop straight away). Contact {contact}. You can also complain to your data protection authority; in the UK that is the Information Commissioner&apos;s Office (ico.org.uk).</p>

      <H id="cookies">8. Cookies</H>
      <p>We use only cookies needed to run the service: sign-in session cookies from our authentication provider and one cookie that remembers your light or dark theme. There is no advertising or analytics tracking.</p>

      <H id="changes">9. Changes</H>
      <p>If we change this policy we will update the date above.</p>
    </main>
  );
}
