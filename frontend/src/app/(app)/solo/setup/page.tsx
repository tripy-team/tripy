import { redirect } from 'next/navigation';

// The solo setup flow has been retired and merged into the unified "Plan a Trip"
// experience at /plan, which handles a single traveler or a whole group.
// Existing deep links to /solo/setup land on the unified flow.
// The original implementation is preserved at src/legacy/solo-setup-page.tsx.bak.
export default function SoloSetupRedirect() {
  redirect('/plan');
}
