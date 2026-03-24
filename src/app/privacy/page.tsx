export const metadata = {
  title: 'Privacy Policy | PPC Analytics',
  description: 'Privacy Policy for PPC Analytics - Amazon Advertising Intelligence Platform',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-8">
            <svg className="w-7 h-7 text-orange-500" viewBox="0 0 24 24" fill="currentColor">
              <rect x="2" y="12" width="5" height="10" rx="1" />
              <rect x="9.5" y="6" width="5" height="16" rx="1" />
              <rect x="17" y="2" width="5" height="20" rx="1" />
            </svg>
            <span className="text-lg font-bold text-gray-900">PPC Analytics</span>
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Last updated: March 2025</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Overview</h2>
            <p>
              PPC Analytics (&quot;we&quot;, &quot;our&quot;, or &quot;the Platform&quot;) is an Amazon Advertising data
              analytics platform. This Privacy Policy explains how we collect, use, and protect your
              information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account information:</strong> Email address and name provided during registration.
              </li>
              <li>
                <strong>Amazon Advertising data:</strong> Campaign metrics, keyword performance, search
                term reports, and spend data retrieved via the Amazon Advertising API on your behalf.
              </li>
              <li>
                <strong>OAuth tokens:</strong> Amazon API access and refresh tokens, stored encrypted
                at rest using AES-256 encryption.
              </li>
              <li>
                <strong>Usage data:</strong> Dashboard interactions and sync logs for debugging and
                service improvement.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Data</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To retrieve and display your Amazon Advertising performance data</li>
              <li>To generate alerts and optimization recommendations</li>
              <li>To schedule automated daily data syncs</li>
              <li>To generate performance reports at your request</li>
              <li>To maintain and improve the platform</li>
            </ul>
            <p className="mt-3">
              We do <strong>not</strong> sell your data to third parties. We do not use your Amazon
              Advertising data for any purpose other than providing the service to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Amazon API Access</h2>
            <p>
              This platform connects to the Amazon Advertising API using OAuth 2.0 (Login with Amazon).
              We request the <code className="bg-gray-100 px-1 rounded text-sm">advertising::campaign_management</code> scope
              to read your campaign data. We do <strong>not</strong> write, modify, or delete any
              campaigns, keywords, or bids in your Amazon account. Access is read-only.
            </p>
            <p className="mt-3">
              You can revoke our access at any time from your Amazon account at{' '}
              <strong>amazon.com → Account &amp; Lists → Apps &amp; Services → Manage Your Apps</strong>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Storage &amp; Security</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>All data is stored in a secure PostgreSQL database (Supabase)</li>
              <li>OAuth tokens are encrypted at rest using AES-256</li>
              <li>All data transmission is encrypted via TLS 1.2+</li>
              <li>Row-level security ensures you can only access your own data</li>
              <li>Automated daily backups with 30-day retention</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Data Retention</h2>
            <p>
              We retain your advertising data for as long as your account is active. Upon account
              deletion, all your data is permanently deleted within 30 days, in compliance with
              GDPR and CCPA requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Your Rights</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Access:</strong> Request a copy of all data we hold about you</li>
              <li><strong>Deletion:</strong> Request permanent deletion of your account and data</li>
              <li><strong>Portability:</strong> Export your data in CSV or JSON format</li>
              <li><strong>Correction:</strong> Update any inaccurate account information</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cookies</h2>
            <p>
              We use session cookies solely for authentication purposes (to keep you logged in).
              We do not use tracking cookies or third-party advertising cookies.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Contact</h2>
            <p>
              For privacy-related questions or data deletion requests, contact us at:{' '}
              <strong>privacy@ppcanalytics.app</strong>
            </p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t border-gray-100 text-sm text-gray-400">
          © {new Date().getFullYear()} PPC Analytics. All rights reserved.
        </div>
      </div>
    </main>
  )
}
