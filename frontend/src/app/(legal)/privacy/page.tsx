export default function PrivacyPage() {
	return (
		<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
			<section className="mx-auto max-w-4xl px-8 py-12">
				<h1 className="mb-6 text-5xl font-bold text-slate-900 tracking-tight">
					Privacy Policy
				</h1>
				<p className="mb-8 text-lg text-slate-600">
					Your privacy is important to us. This Privacy Policy explains how
					Tripy collects, uses, and protects your personal information.
				</p>

				<div className="space-y-8">
					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							1. Information We Collect
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							We collect information that you provide directly to us, such as when
							you create an account, make a booking, or contact support. We also
							collect data automatically through cookies and similar technologies.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							2. How We Use Information
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							We use your information to provide and improve our services,
							personalize your experience, process bookings, and communicate with
							you.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							3. Data Sharing
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							We do not sell your personal information. We may share it with trusted
							partners who help us operate our services, or when required by law.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							4. Data Security
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							We implement industry-standard measures to protect your personal data
							from unauthorized access, alteration, or destruction.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							5. Your Rights
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							You have the right to access, update, or delete your information. If
							you wish to exercise these rights, please contact us at{" "}
							<a href="mailto:privacy@tripy.com" className="text-blue-600 hover:text-blue-700 underline">
								privacy@tripy.com
							</a>
							.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							6. Changes to this Policy
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							We may update this Privacy Policy periodically. Updates will be posted
							on this page with an updated revision date.
						</p>
					</div>

					<div>
						<h2 className="mt-8 text-2xl font-semibold text-slate-900">
							7. Contact Us
						</h2>
						<p className="mt-2 text-slate-600 leading-relaxed">
							If you have any questions about this Privacy Policy, please contact us
							at{" "}
							<a href="mailto:privacy@tripy.com" className="text-blue-600 hover:text-blue-700 underline">
								privacy@tripy.com
							</a>
							.
						</p>
					</div>
				</div>
			</section>
		</main>
	);
}
