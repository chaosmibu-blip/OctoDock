/* 退款政策頁面 — Paddle KYB 驗證用 */
import Link from "next/link";
import { BASE_URL } from "@/lib/constants";

export const metadata = {
  title: "Refund Policy - OctoDock",
  description: "OctoDock refund policy — 14-day full refund, cancel anytime.",
  alternates: { canonical: `${BASE_URL}/refund` },
};

export default function RefundPage() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 返回首頁 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8 text-4xl font-bold text-gray-900">Refund Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: March 23, 2026</p>

        <div className="mt-10 space-y-8 text-gray-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900">1. Subscription Model</h2>
            <p className="mt-3">
              OctoDock is a SaaS (Software as a Service) product offered on a subscription basis.
              All paid plans are billed either monthly or annually, depending on the billing cycle
              you choose at the time of purchase.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">2. Cancellation Policy</h2>
            <p className="mt-3">
              You may cancel your subscription at any time from your account dashboard or by
              contacting our support team. Upon cancellation:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Your subscription remains active until the end of the current billing period</li>
              <li>You will not be charged for subsequent billing periods</li>
              <li>You retain full access to paid features until the billing period expires</li>
              <li>Your account will automatically revert to the Free plan after expiration</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">3. Refund Eligibility</h2>
            <p className="mt-3">
              We offer a <strong>14 calendar day refund window</strong> from the date of each payment.
              If you are not satisfied with OctoDock for any reason, you may request a full refund
              within 14 calendar days from the date of purchase.
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Refund requests made within 14 calendar days of the date of purchase will receive a <strong>full refund</strong></li>
              <li>Refund requests made after 14 calendar days will not be eligible for a refund, but you may cancel to prevent future charges</li>
              <li>Refunds are processed back to the original payment method</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">4. How to Request a Refund</h2>
            <p className="mt-3">
              To request a refund, please contact our support team at{" "}
              <a href="mailto:support@octo-dock.com" className="text-emerald-600 hover:text-emerald-700 underline">
                support@octo-dock.com
              </a>{" "}
              with the following information:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Your account email address</li>
              <li>Date of the charge you wish to refund</li>
              <li>Reason for the refund request (optional, but helps us improve)</li>
            </ul>
            <p className="mt-3">
              We aim to process all refund requests within <strong>5 business days</strong>. You will
              receive an email confirmation once the refund has been processed.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">5. Exceptions</h2>
            <p className="mt-3">
              Refunds may not be available in the following cases:
            </p>
            <ul className="mt-3 space-y-1.5 list-disc list-inside">
              <li>Abuse of the refund policy (e.g., repeated subscribe-and-refund cycles)</li>
              <li>Violation of our Terms of Service leading to account termination</li>
              <li>Chargebacks initiated without first contacting our support team</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900">6. Contact Us</h2>
            <p className="mt-3">
              If you have any questions about our refund policy, please reach out to us at:{" "}
              <a href="mailto:support@octo-dock.com" className="text-emerald-600 hover:text-emerald-700 underline">
                support@octo-dock.com
              </a>
            </p>
          </section>
        </div>

        {/* 底部連結 */}
        <div className="mt-12 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm">
          <Link href="/pricing" className="text-gray-500 hover:text-gray-700 transition-colors">
            Pricing
          </Link>
          <Link href="/terms" className="text-gray-500 hover:text-gray-700 transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy" className="text-gray-500 hover:text-gray-700 transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
