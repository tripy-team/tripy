export default function ContactPage() {
	return (
		<main className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white text-slate-900">
			<section className="mx-auto max-w-4xl px-8 py-12">
				<h1 className="mb-6 text-5xl font-bold text-slate-900 tracking-tight">
					Contact Us
				</h1>
				<p className="mb-8 text-lg text-slate-600 leading-relaxed">
					Have questions or feedback? We'd love to hear from you.
				</p>

				<div className="space-y-12 mt-12">
					{/* CONTACT */}
					<div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
						<h2 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-6">
							Contact
						</h2>
						<a
							href="mailto:tripy@legit-email.com"
							className="text-lg text-blue-600 hover:text-blue-700 underline inline-block mb-6"
						>
							tripy@legit-email.com
						</a>

						{/* Socials */}
						<div className="flex items-center gap-4 pt-4">
							{/* X / Twitter */}
							<a
								href="https://x.com/tripy"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="X (Twitter)"
								className="text-slate-600 hover:text-blue-600 transition-colors"
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="currentColor"
								>
									<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
								</svg>
							</a>

							{/* LinkedIn */}
							<a
								href="https://www.linkedin.com/company/tripy"
								target="_blank"
								rel="noopener noreferrer"
								aria-label="LinkedIn"
								className="text-slate-600 hover:text-blue-600 transition-colors"
							>
								<svg
									width="20"
									height="20"
									viewBox="0 0 24 24"
									fill="currentColor"
								>
									<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
								</svg>
							</a>
						</div>
					</div>

					{/* FOUNDERS */}
					<div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
						<h2 className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-6">
							Founders
						</h2>
						<div className="flex flex-col gap-4">
							<a
								href="https://www.linkedin.com/in/ericzhong1/"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2 text-lg text-blue-600 hover:text-blue-700 transition-colors font-semibold"
							>
								<svg
									viewBox="0 0 24 24"
									className="h-4 w-4"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
								</svg>
								<span>Eric Zhong</span>
							</a>
							<a
								href="http://linkedin.com/in/its-david-garzon/"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-2 text-lg text-blue-600 hover:text-blue-700 transition-colors font-semibold"
							>
								<svg
									viewBox="0 0 24 24"
									className="h-4 w-4"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z" />
								</svg>
								<span>David Garzon</span>
							</a>
						</div>
					</div>
				</div>
			</section>
		</main>
	);
}
