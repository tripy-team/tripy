export default function Page() {
	return (
		<main className="relative z-10 min-h-dvh pt-[112px] pb-20 text-white md:pt-[128px]">
			{/* Centered, narrow measure (matches Astro feel) */}
			<div className="mx-auto max-w-[800px] space-y-12 px-4">
				{/* Intro */}
				<p className="mx-auto max-w-[680px] text-left text-[14px] leading-[1.65] text-white/80 md:text-[15px]">
					Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque
					eu lobortis purus. Nullam orci turpis, blandit nec nunc ut, blandit
					viverra tellus. Nulla facilisis suscipit tempus. Aenean varius sed
					turpis vitae sodales. Sed massa purus, mollis a mauris ac, volutpat
					molestie urna. Vestibulum eget venenatis erat, vel cursus lorem.
					Curabitur non mollis ipsum. Vestibulum convallis dui quis mollis
					elementum. Vestibulum vitae tempus velit. Suspendisse consectetur at
					turpis interdum lobortis. Nullam efficitur nisi erat, a hendrerit
					lorem placerat in. Nam quam arcu, malesuada eget dapibus vitae,
					sodales non dui. Curabitur quam nunc, venenatis in sodales hendrerit,
					gravida id lacus. Sed tincidunt tempor augue, eget dictum orci auctor
					vitae. Sed a lorem felis. Mauris quis nisl id nisl placerat viverra.
				</p>

				{/* TEAM + ADVISORS */}
				<div className="grid grid-cols-1 gap-10 md:grid-cols-2">
					{/* TEAM */}
					<div className="space-y-3.5">
						<h2 className="text-[11px] font-semibold tracking-[0.22em] text-white/60">
							TEAM
						</h2>
						<div className="flex flex-col gap-[6px]">
							<span className="text-[14px] font-semibold text-white/90 md:text-[15px]">
								Eric Zhong
							</span>
							<span className="text-[14px] font-semibold text-white/90 md:text-[15px]">
								David Garzon
							</span>
							<a
								href="mailto:tripy-dev@gmail.com"
								className="mt-2 text-[13px] text-white/90 underline decoration-white/30 underline-offset-4 transition hover:decoration-white/70 md:text-[14px]"
							>
								Trip with us? Join our team!
							</a>
						</div>
					</div>

					{/* ADVISORS */}
					<div className="space-y-3.5">
						<h2 className="text-[11px] font-semibold tracking-[0.22em] text-white/60">
							ADVISORS
						</h2>
						<div className="flex flex-col gap-[6px]">
							<div className="flex items-baseline gap-2">
								<span className="text-[14px] font-semibold text-white/90 md:text-[15px]">
									John Doe
								</span>
								<span className="text-[12px] text-white/60 md:text-[13px]">
									CEO, @company
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* INVESTORS */}
				<div className="space-y-3.5">
					<h2 className="text-[11px] font-semibold tracking-[0.22em] text-white/60">
						INVESTORS
					</h2>
					<div className="grid grid-cols-1 gap-10 md:grid-cols-2">
						{/* Column 1 */}
						<div className="flex flex-col gap-[6px]">
							<div className="flex items-baseline gap-2">
								<span className="text-[14px] font-semibold text-white/90 md:text-[15px]">
									Jane Doe
								</span>
								<span className="text-[12px] text-white/60 md:text-[13px]">
									Former CEO of CoolerCompany
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}
