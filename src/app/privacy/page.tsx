/* 隱私權政策頁面 */
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy - OctoDock",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto prose prose-gray">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8">Privacy Policy</h1>
        <p className="text-sm text-gray-500">Last updated: March 16, 2026</p>

        <h2>1. Introduction</h2>
        <p>
          OctoDock (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the octo-dock.com website and the OctoDock
          MCP service. This Privacy Policy explains how we collect, use, disclose, and safeguard
          your information when you use our service.
        </p>

        <h2>2. Information We Collect</h2>
        <h3>2.1 Account Information</h3>
        <p>
          When you sign in with Google, we receive your name, email address, and profile picture
          from your Google account. We use this information solely to create and manage your
          OctoDock account.
        </p>

        <h3>2.2 Connected App Tokens</h3>
        <p>
          When you connect third-party apps (e.g., Notion, Gmail, Google Calendar), we store
          OAuth access tokens and refresh tokens to maintain your connections. All tokens are
          encrypted using AES-256-GCM before storage and are never logged or exposed in
          plaintext.
        </p>

        <h3>2.3 Usage Data &amp; Memory</h3>
        <p>
          OctoDock stores operational memory (preferences, patterns, and context) to improve
          your experience across AI agents. This data is associated with your account and is
          not shared with other users.
        </p>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To provide and maintain the OctoDock service</li>
          <li>To execute actions on connected apps on your behalf via AI agents</li>
          <li>To store and retrieve your cross-agent memory and preferences</li>
          <li>To improve service quality and user experience</li>
        </ul>

        <h2>4. Data Sharing</h2>
        <p>
          We do not sell, trade, or rent your personal information. Your data is only shared
          with third-party services when you explicitly connect them through OctoDock, and
          only to the extent necessary to perform the actions you request.
        </p>

        <h2>5. Data Security</h2>
        <p>
          We implement industry-standard security measures including:
        </p>
        <ul>
          <li>AES-256-GCM encryption for all stored tokens</li>
          <li>HTTPS for all data in transit</li>
          <li>Secure PostgreSQL database with access controls</li>
          <li>Error isolation — one app failure does not expose data from another</li>
        </ul>

        <h2>6. Data Retention &amp; Deletion</h2>
        <p>
          You can disconnect any app at any time from your dashboard, which immediately revokes
          and deletes the associated tokens. You may request full account deletion by contacting
          us, after which all your data will be permanently removed within 30 days.
        </p>

        <h2>7. Third-Party Services</h2>
        <p>
          OctoDock integrates with third-party services (Google, Notion, GitHub, etc.). Each
          service has its own privacy policy. We encourage you to review them before connecting.
        </p>

        <h2>8. Children&apos;s Privacy</h2>
        <p>
          OctoDock is not intended for use by children under 13. We do not knowingly collect
          personal information from children under 13.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will notify you of any
          changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy, please contact us at:{" "}
          <a href="mailto:support@octo-dock.com">support@octo-dock.com</a>
        </p>
      </div>
    </div>
  );
}
