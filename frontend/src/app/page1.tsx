import NavBar from "@/components/NavBar";
import WaitlistButton from "@/components/waitlist-button";

export default function Page() {
	return (
		<div className="relative h-[100dvh] overflow-hidden">
			<NavBar />
			<main className="relative flex h-full flex-col items-center">
				<div className="relative w-full">
					<div className="main-content mx-auto mt-[120px] max-w-[920px] px-4 text-center md:mt-[140px]">
						<div className="space-y-2">
							<h1 className="text-[32px] leading-[1.2] font-semibold tracking-[-0.02em] whitespace-nowrap text-white md:text-[56px]">
								Tailored Trips
							</h1>
							<h2 className="text-[32px] leading-[1.2] font-semibold tracking-[-0.02em] text-white/95 md:text-[56px]">
							 	Simplified Travel
							</h2>
						</div>

						<p className="mx-auto mt-4 max-w-[280px] text-[16px] leading-[1.6] text-white/70 md:mt-5 md:max-w-[540px] md:text-[18px]">
							End-to-end trip planning and reservations powered by Tripy AI
						</p>

						<div className="mt-7 hidden md:block">
							<WaitlistButton />
						</div>
					</div>
				</div>

				{/* Mobile CTA positioned to avoid keyboard interference */}
				<div className="relative w-full" />
			</main>
		</div>
	);
}
