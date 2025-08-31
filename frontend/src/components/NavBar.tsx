import Link from "next/link";

export default function NavBar() {
	return (
		<div className="fixed top-5 right-0 left-0 z-50 mx-auto w-full max-w-[520px] px-4">
			<nav className="flex h-[42px] items-center rounded-full border border-[#ffffff0f] bg-[#18181B]/95 px-4 shadow-[0_0_32px_0_rgba(0,0,0,0.2)] backdrop-blur-md md:h-[46px] md:px-5">
				<div className="nav-content pointer-events-none relative flex w-full items-center justify-between">
					{/* Logo */}
					<Link href="/" className="logo-group pointer-events-auto z-10">
						<img
							src="/logo.png"
							alt="Tripy"
							className="h-[15px] w-auto object-contain md:h-[25px]"
						/>
					</Link>

					{/* Center links */}
					<div className="pointer-events-auto absolute left-1/2 z-20 flex -translate-x-1/2 items-center">
						<div className="flex items-center gap-4 md:gap-7">
							<Link
								href="/about"
								className="relative text-[12px] text-[#ffffffb3] transition-colors after:absolute after:right-0 after:-bottom-1 after:left-0 after:h-[1px] after:bg-white after:opacity-0 after:transition-opacity hover:text-white hover:after:opacity-50 md:text-[13.5px]"
							>
								About
							</Link>
							<Link
								href="/contact"
								className="relative text-[12px] text-[#ffffffb3] transition-colors after:absolute after:right-0 after:-bottom-1 after:left-0 after:h-[1px] after:bg-white after:opacity-0 after:transition-opacity hover:text-white hover:after:opacity-50 md:text-[13.5px]"
							>
								Contact
							</Link>
						</div>
					</div>

					{/* Take off */}
					<div className="pointer-events-auto z-10">
						<button
							id="takeoffButton"
							className="flex items-center rounded-full border border-[#ffffff0f] bg-[#27272A]/80 px-3 py-1.5 shadow-[0_2px_3px_0_rgba(0,0,0,0.1)] transition-all hover:bg-[#27272A] md:px-4 md:py-2"
						>
							<div className="mr-1.5 h-1 w-1 rounded-full bg-[#4ADE80] md:mr-2 md:h-1.5 md:w-1.5" />
							<span className="text-[12px] whitespace-nowrap text-white md:text-[13.5px]">
								Take a Trip
							</span>
						</button>
					</div>
				</div>
			</nav>
		</div>
	);
}
