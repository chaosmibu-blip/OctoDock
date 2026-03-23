/* 服務條款頁面 */
import Link from "next/link";
import { BASE_URL } from "@/lib/constants";

export const metadata = {
  title: "Terms of Service - OctoDock",
  description: "OctoDock terms of service — usage rules for the unified MCP endpoint.",
  alternates: { canonical: `${BASE_URL}/terms` },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 返回首頁 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8 text-4xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: March 23, 2026</p>

        <div className="mt-10 space-y-8 text-gray-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Acceptance of Terms</h2>
            <p className="mt-3">
              By accessing or using OctoDock (&quot;the Service&quot;), operated by Chaos Co., Ltd.
              (查爾斯有限公司), a company registered in Taiwan (&quot;the Company&quot;, &quot;we&quot;, &quot;us&quot;,
              or &quot;our&quot;) at octo-dock.com, you agree
              to be bound by these Terms of Service. If you do not agree to these terms, please do
              not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. Description of Service</h2>
            <p className="mt-3">
              OctoDock provides a unified MCP (Model Context Protocol) endpoint that allows AI
              agents to interact with multiple third-party applications on your behalf. The Service
              includes app connections, cross-agent memory, and bot auto-reply.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. Account &amp; Authentication</h2>
            <p className="mt-3">
              You must sign in with a valid Google account to use OctoDock. You are responsible for
              maintaining the security of your account and all activities that occur under it. You
              must not share your MCP URL or API key with unauthorized parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. Connected Apps &amp; Authorization</h2>
            <p className="mt-3">
              When you connect a third-party app to OctoDock, you authorize us to access that app
              on your behalf within the scope of permissions you grant. You may revoke access to any
              connected app at any time from your dashboard.
            </p>
            <p className="mt-2">
              You are responsible for ensuring that actions performed through OctoDock comply with
              the terms of service of each connected app.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. Acceptable Use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to other users&apos; accounts or data</li>
              <li>Use the Service to send spam, phishing, or malicious content</li>
              <li>Reverse engineer, decompile, or attempt to extract the source code of the Service</li>
              <li>Exceed reasonable usage limits or abuse API rate limits</li>
              <li>Resell or redistribute the Service without written permission</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Service Plans &amp; Billing</h2>
            <p className="mt-3">
              OctoDock offers free and paid plans. Paid features are billed according to the pricing
              displayed at the time of purchase. We reserve the right to change pricing with 30 days
              notice. Refund policies follow the terms of the respective payment processor (Paddle,
              ECPay, or App Store).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">7. Data &amp; Privacy</h2>
            <p className="mt-3">
              Your use of the Service is also governed by our{" "}
              <Link href="/privacy" className="text-emerald-600 hover:text-emerald-700 underline">
                Privacy Policy
              </Link>. We encrypt all stored tokens and do not sell your personal data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">8. Intellectual Property</h2>
            <p className="mt-3">
              The OctoDock name, logo, and service are protected by applicable intellectual property
              laws. The Service is licensed under BSL 1.1 — you may use it for personal and internal
              business purposes, but you may not offer a competing hosted service based on OctoDock
              without permission.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">9. Disclaimers</h2>
            <p className="mt-3">
              The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind.
              We do not guarantee that the Service will be uninterrupted, error-free, or that
              third-party APIs will always be available.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">10. Limitation of Liability</h2>
            <p className="mt-3">
              To the maximum extent permitted by law, OctoDock and its operators shall not be liable
              for any indirect, incidental, special, or consequential damages arising from your use
              of the Service, including but not limited to loss of data, revenue, or business
              opportunities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">11. Termination</h2>
            <p className="mt-3">
              We may suspend or terminate your access to the Service at any time for violation of
              these terms. You may delete your account at any time. Upon termination, your data will
              be handled as described in our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">12. Changes to Terms</h2>
            <p className="mt-3">
              We may update these Terms from time to time. Continued use of the Service after
              changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">13. Governing Law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of Taiwan (R.O.C.). Any disputes shall be
              resolved in the courts of Taipei, Taiwan.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">14. Contact Us</h2>
            <p className="mt-3">
              If you have questions about these Terms, please contact us at:{" "}
              <a href="mailto:support@octo-dock.com" className="text-emerald-600 hover:text-emerald-700 underline">
                support@octo-dock.com
              </a>
            </p>
          </section>
        </div>

        {/* 底部連結 */}
        <div className="mt-12 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm">
          <Link href="/privacy" className="text-gray-500 hover:text-gray-700 transition-colors">
            Privacy Policy
          </Link>
          <Link href="/docs" className="text-gray-500 hover:text-gray-700 transition-colors">
            Documentation
          </Link>
        </div>
      </div>
    </div>
  );
}
