"use client";

export default function WaitlistButton() {
	return (
		<div className="flex flex-col items-center">
			<div className="flex w-full justify-center">
				<div className="group relative h-[56px] w-full overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br from-white/[0.12] via-white/[0.08] to-transparent px-6 shadow-[inset_0_1px_1px_white/10,0_8px_40px_-12px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.1)] backdrop-blur-md transition-[width,padding,height] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] md:h-[48px] md:w-[180px]">
					<div className="absolute inset-0 bg-gradient-to-br from-white/[0.2] to-transparent opacity-50" />
					<div className="absolute inset-[-20%] animate-[drift_12s_linear_infinite] bg-[radial-gradient(circle_at_center,white_0%,transparent_60%)] opacity-[0.08]" />
					<div className="absolute inset-0">
						<div className="absolute inset-[-50%] animate-[spin_8s_linear_infinite] bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0%,white_25%,transparent_50%)] opacity-[0.07]" />
						<div className="absolute inset-[-20%] animate-[breathe_4s_ease-in-out_infinite] bg-[radial-gradient(ellipse_at_top,white,transparent_70%)] opacity-[0.07]" />
						<div className="absolute inset-[-10%] animate-[float_6s_ease-in-out_infinite_alternate] bg-[radial-gradient(circle_at_60%_60%,white,transparent_50%)] opacity-[0.06]" />
					</div>
					<div className="absolute inset-0 animate-[shimmer_3s_ease-in-out_infinite] bg-[linear-gradient(90deg,transparent_0%,white_50%,transparent_100%)] opacity-[0.08]" />

					<div className="relative z-10 flex h-full items-center">
						{/* Initial "Join Waitlist" state */}
						<div className="w-full scale-100 opacity-100 transition-all duration-300">
							<button className="group/btn flex w-full cursor-pointer items-center justify-center gap-3">
								<span className="text-[15px] font-medium tracking-wide whitespace-nowrap text-white/90 text-shadow-[0_0_10px_rgba(255,255,255,0.5)] group-hover/btn:text-shadow-[0_0_15px_rgba(255,255,255,0.7)]">
									Join Waitlist
								</span>
								<svg
									width="20"
									height="20"
									viewBox="0 0 20 20"
									fill="none"
									className="text-white/90 transition-all duration-300 group-hover/btn:translate-x-1 group-hover/btn:scale-110"
								>
									<path
										d="M2.5 10H17.5M17.5 10L11.5 4M17.5 10L11.5 16"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
										className="group-hover/btn:stroke-[2.5]"
									/>
								</svg>
							</button>
						</div>

						{/* Hidden expanded state (kept for parity) */}
						<div className="pointer-events-none absolute w-full scale-95 opacity-0 transition-all duration-300">
							<div className="w-full space-y-3">
								<div className="flex w-full items-center gap-2">
									<div className="relative w-[72px]">
										<button
											type="button"
											className="group/select relative z-[100] flex h-[48px] w-full items-center gap-1.5 rounded-xl border border-white/20 px-2 transition-all duration-200 md:h-[44px]"
										>
											<span className="text-base">🇺🇸</span>
											<span className="text-[13px] leading-none font-medium text-white/90">
												+1
											</span>
											<svg
												className="ml-auto h-3 w-3 text-white/50 transition-transform duration-200"
												viewBox="0 0 20 20"
												fill="none"
												strokeWidth="1.5"
												stroke="currentColor"
											>
												<path
													d="M6 8l4 4 4-4"
													strokeLinecap="round"
													strokeLinejoin="round"
												/>
											</svg>
										</button>
									</div>

									<div className="flex-1">
										<input
											type="tel"
											placeholder="(123) 456-7890"
											className="h-[48px] w-full rounded-xl border border-white/20 px-3 text-base text-white/90 transition-all duration-200 placeholder:text-white/40 focus:border-white/40 md:h-[44px]"
										/>
									</div>
								</div>

								<button
									type="button"
									disabled
									className="relative h-[44px] w-full cursor-not-allowed overflow-hidden rounded-xl border border-white/10 bg-white/[0.08] text-[15px] font-medium text-white/40 transition-all duration-300"
								>
									<div className="relative z-10 flex items-center justify-center gap-2">
										<span>Continue</span>
									</div>
								</button>
							</div>
						</div>
					</div>

					{/* Error helper (hidden by default for parity) */}
					<div className="mt-2.5 -translate-y-1 opacity-0 transition-all duration-200">
						<div className="flex items-center justify-center gap-1.5">
							<svg
								className="h-3 w-3 text-[#FF8674]"
								viewBox="0 0 20 20"
								fill="currentColor"
							>
								<path
									fillRule="evenodd"
									d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
								/>
							</svg>
							<span className="text-[13px] font-medium tracking-tight text-[#FF8674]">
								Please enter a valid phone number
							</span>
						</div>
					</div>

					{/* Socials (hidden by default for parity) */}
					<div className="pointer-events-none translate-y-2 opacsity-0 transition-all duration-300">
						<div className="mt-4 flex items-center justify-center gap-4">
							<a
								href="https://www.linkedin.com/company/tripy/"
								target="_blank"
								rel="noopener noreferrer"
								className="group flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-white/[0.12] via-white/[0.08] to-transparent backdrop-blur-md transition-all duration-300 hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] md:h-11 md:w-11"
								aria-label="Follow us on LinkedIn"
							>
								<svg
									className="h-5 w-5 text-white/90 transition-all duration-300 group-hover:scale-110 md:h-5 md:w-5"
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M16 8C17.5913 8 19.1174 8.63214 20.2426 9.75736C21.3679 10.8826 22 12.4087 22 14V21H18V14C18 13.4696 17.7893 12.9609 17.4142 12.5858C17.0391 12.2107 16.5304 12 16 12C15.4696 12 14.9609 12.2107 14.5858 12.5858C14.2107 12.9609 14 13.4696 14 14V21H10V14C10 12.4087 10.6321 10.8826 11.7574 9.75736C12.8826 8.63214 14.4087 8 16 8Z"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									<path
										d="M6 9H2V21H6V9Z"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									<path
										d="M4 6C5.10457 6 6 5.10457 6 4C6 2.89543 5.10457 2 4 2C2.89543 2 2 2.89543 2 4C2 5.10457 2.89543 6 4 6Z"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</a>

							<a
								href="https://x.com/tripyapp"
								target="_blank"
								rel="noopener noreferrer"
								className="group flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-gradient-to-br from-white/[0.12] via-white/[0.08] to-transparent backdrop-blur-md transition-all duration-300 hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] md:h-11 md:w-11"
								aria-label="Follow us on Twitter/X"
							>
								<svg
									className="h-5 w-5 text-white/90 transition-all duration-300 group-hover:scale-110 md:h-5 md:w-5"
									viewBox="0 0 24 24"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M22 4.01C21 4.5 20.02 4.69 19 5C17.879 3.735 16.217 3.665 14.62 4.263C13.023 4.861 11.977 6.323 12 8.01V9.01C8.755 9.083 5.865 7.605 4 5.01C4 5.01 0 13.01 8 17.01C6.214 18.169 4.122 18.85 2 19.01C10 24.01 20 19.01 20 8.01C19.9991 7.71851 19.9723 7.42795 19.92 7.14C20.94 6.14 21.62 4.86 22 4.01Z"
										stroke="currentColor"
										strokeWidth="1.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</a>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
