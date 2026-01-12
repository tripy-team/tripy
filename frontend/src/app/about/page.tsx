export default function AboutPage() {
	return (
		<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
			<section className="mx-auto max-w-4xl px-8 py-12">
				<h1 className="mb-6 text-5xl font-bold text-slate-900 tracking-tight">
					About Tripy
				</h1>
				<p className="mb-8 text-lg text-slate-600 leading-relaxed">
					Tired of itinerary scheduling, manual calculations, and fragmented
					travel tips? Our team of Amazon engineers and frustrated travelers are
					revolutionizing the trip planning process with Tripy AI.
				</p>

				<div className="space-y-12 mt-12">
					{/* TEAM */}
					<div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
						<h2 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-6">
							Team
						</h2>
						<div className="flex flex-col gap-4">
							<div>
								<span className="text-lg font-semibold text-slate-900">Eric Zhong</span>
							</div>
							<div>
								<span className="text-lg font-semibold text-slate-900">David Garzon</span>
							</div>
							<a
								href="mailto:tripy-dev@gmail.com"
								className="mt-4 text-blue-600 hover:text-blue-700 underline inline-block"
							>
								Trip with us? Join our team!
							</a>
						</div>
					</div>

					{/* ADVISORS */}
					<div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
						<h2 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-6">
							Advisors
						</h2>
						<div className="flex flex-col gap-4">
							<div className="flex items-baseline gap-3">
								<span className="text-lg font-semibold text-slate-900">John Doe</span>
								<span className="text-sm text-slate-600">CEO, @company</span>
							</div>
						</div>
					</div>

					{/* INVESTORS */}
					<div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
						<h2 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-6">
							Investors
						</h2>
						<div className="flex flex-col gap-4">
							<div className="flex items-baseline gap-3">
								<span className="text-lg font-semibold text-slate-900">Jane Doe</span>
								<span className="text-sm text-slate-600">Former CEO of CoolerCompany</span>
							</div>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
