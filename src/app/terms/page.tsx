/* 服務條款頁面 */
import Link from "next/link";

export const metadata = {
  title: "Terms of Service - OctoDock",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto prose prose-gray">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8">Terms of Service</h1>
        <p className="text-sm text-gray-500">Last updated: March 16, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using OctoDock (&quot;the Service&quot;), operated at octo-dock.com, you agree
          to be bound by these Terms of Service. If you do not agree to these terms, please do
          not use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          OctoDock provides a unified MCP (Model Context Protocol) endpoint that allows AI
          agents to interact with multiple third-party applications on your behalf. The Service
          includes app connections, cross-agent memory, bot auto-reply, and scheduled operations.
        </p>

        <h2>3. Account &amp; Authentication</h2>
        <p>
          You must sign in with a valid Google account to use OctoDock. You are responsible for
          maintaining the security of your account and all activities that occur under it. You
          must not share your MCP URL or API key with unauthorized parties.
        </p>

        <h2>4. Connected Apps &amp; Authorization</h2>
        <p>
          When you connect a third-party app to OctoDock, you authorize us to access that app
          on your behalf within the scope of permissions you grant. You may revoke access to any
          connected app at any time from your dashboard.
        </p>
        <p>
          You are responsible for ensuring that actions performed through OctoDock comply with
          the terms of service of each connected app.
        </p>

        <h2>5. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Attempt to gain unauthorized access to other users&apos; accounts or data</li>
          <li>Use the Service to send spam, phishing, or malicious content</li>
          <li>Reverse engineer, decompile, or attempt to extract the source code of the Service</li>
          <li>Exceed reasonable usage limits or abuse API rate limits</li>
          <li>Resell or redistribute the Service without written permission</li>
        </ul>

        <h2>6. Service Plans &amp; Billing</h2>
        <p>
          OctoDock offers free and paid plans. Paid features are billed according to the pricing
          displayed at the time of purchase. We reserve the right to change pricing with 30 days
          notice. Refund policies follow the terms of the respective payment processor (Paddle,
          ECPay, or App Store).
        </p>

        <h2>7. Data &amp; Privacy</h2>
        <p>
          Your use of the Service is also governed by our{" "}
          <Link href="/privacy">Privacy Policy</Link>. We encrypt all stored tokens and do not
          sell your personal data.
        </p>

        <h2>8. Intellectual Property</h2>
        <p>
          The OctoDock name, logo, and service are protected by applicable intellectual property
          laws. The Service is licensed under BSL 1.1 — you may use it for personal and internal
          business purposes, but you may not offer a competing hosted service based on OctoDock
          without permission.
        </p>

        <h2>9. Disclaimers</h2>
        <p>
          The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind.
          We do not guarantee that the Service will be uninterrupted, error-free, or that
          third-party APIs will always be available.
        </p>

        <h2>10. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, OctoDock and its operators shall not be liable
          for any indirect, incidental, special, or consequential damages arising from your use
          of the Service, including but not limited to loss of data, revenue, or business
          opportunities.
        </p>

        <h2>11. Termination</h2>
        <p>
          We may suspend or terminate your access to the Service at any time for violation of
          these terms. You may delete your account at any time. Upon termination, your data will
          be handled as described in our Privacy Policy.
        </p>

        <h2>12. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Service after
          changes constitutes acceptance of the new terms.
        </p>

        <h2>13. Governing Law</h2>
        <p>
          These Terms are governed by the laws of Taiwan (R.O.C.). Any disputes shall be
          resolved in the courts of Taipei, Taiwan.
        </p>

        <h2>14. Contact Us</h2>
        <p>
          If you have questions about these Terms, please contact us at:{" "}
          <a href="mailto:support@octo-dock.com">support@octo-dock.com</a>
        </p>
      </div>
    </div>
  );
}
