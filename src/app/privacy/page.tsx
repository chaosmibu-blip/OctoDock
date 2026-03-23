/* 隱私權政策頁面 */
import Link from "next/link";
import { BASE_URL } from "@/lib/constants";

export const metadata = {
  title: "Privacy Policy - OctoDock",
  description: "OctoDock privacy policy — how we handle your data and connected app tokens.",
  alternates: { canonical: `${BASE_URL}/privacy` },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 返回首頁 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8 text-4xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: March 16, 2026</p>

        <div className="mt-10 space-y-8 text-gray-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Introduction</h2>
            <p className="mt-3">
              OctoDock (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the octo-dock.com website and the OctoDock
              MCP service. This Privacy Policy explains how we collect, use, disclose, and safeguard
              your information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. Information We Collect</h2>
            <h3 className="mt-4 text-lg font-medium text-gray-800">2.1 Account Information</h3>
            <p className="mt-2">
              When you sign in with Google, we receive your name, email address, and profile picture
              from your Google account. We use this information solely to create and manage your
              OctoDock account.
            </p>

            <h3 className="mt-4 text-lg font-medium text-gray-800">2.2 Connected App Tokens</h3>
            <p className="mt-2">
              When you connect third-party apps (e.g., Notion, Gmail, Google Calendar), we store
              OAuth access tokens and refresh tokens to maintain your connections. All tokens are
              encrypted using AES-256-GCM before storage and are never logged or exposed in
              plaintext.
            </p>

            <h3 className="mt-4 text-lg font-medium text-gray-800">2.3 Usage Data &amp; Memory</h3>
            <p className="mt-2">
              OctoDock stores operational memory (preferences, patterns, context, and saved workflows)
              to improve your experience across AI agents. This data is associated with your account
              and is not shared with other users.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. How We Use Your Information</h2>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>To provide and maintain the OctoDock service</li>
              <li>To execute actions on connected apps on your behalf via AI agents</li>
              <li>To store and retrieve your cross-agent memory and preferences</li>
              <li>To improve service quality and user experience</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. Data Sharing</h2>
            <p className="mt-3">
              We do not sell, trade, or rent your personal information. Your data is only shared
              with third-party services when you explicitly connect them through OctoDock, and
              only to the extent necessary to perform the actions you request.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. Data Security</h2>
            <p className="mt-3">We implement industry-standard security measures including:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>AES-256-GCM encryption for all stored tokens</li>
              <li>HTTPS for all data in transit</li>
              <li>Secure PostgreSQL database with access controls</li>
              <li>Error isolation — one app failure does not expose data from another</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Data Retention &amp; Deletion</h2>
            <p className="mt-3">
              You can disconnect any app at any time from your dashboard, which immediately revokes
              and deletes the associated tokens. You may request full account deletion by contacting
              us, after which all your data will be permanently removed within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">7. Third-Party Services</h2>
            <p className="mt-3">
              OctoDock integrates with third-party services (Google, Notion, GitHub, etc.). Each
              service has its own privacy policy. We encourage you to review them before connecting.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">8. Children&apos;s Privacy</h2>
            <p className="mt-3">
              OctoDock is not intended for use by children under 13. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">9. Changes to This Policy</h2>
            <p className="mt-3">
              We may update this Privacy Policy from time to time. We will notify you of any
              changes by posting the new policy on this page and updating the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">10. Contact Us</h2>
            <p className="mt-3">
              If you have questions about this Privacy Policy, please contact us at:{" "}
              <a href="mailto:support@octo-dock.com" className="text-emerald-600 hover:text-emerald-700 underline">
                support@octo-dock.com
              </a>
            </p>
          </section>
        </div>

        {/* 底部連結 */}
        <div className="mt-12 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm">
          <Link href="/terms" className="text-gray-500 hover:text-gray-700 transition-colors">
            Terms of Service
          </Link>
          <Link href="/docs" className="text-gray-500 hover:text-gray-700 transition-colors">
            Documentation
          </Link>
        </div>
      </div>
    </div>
  );
}
