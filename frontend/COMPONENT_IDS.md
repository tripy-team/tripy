# Component IDs Reference

Stable `data-testid` and `data-slot` attributes for design-to-code mapping and testing. Aligned with Figma route/component names where applicable.

## Attributes

- **data-testid**: Primary referencable ID (kebab-case). Use in tests: `getByTestId('solo-results-page')`.
- **data-slot**: Design/slot name. Matches Figma component names (e.g. `SoloResults`, `Home`) for Code Connect and design tools.

---

## Pages

### Home / Landing
| Element | data-testid | data-slot |
|---------|-------------|-----------|
| Page (loading) | `home-loading` | `loading-spinner-wrapper` |
| Page | `home-page` | `Home` |

### App Layout
| Element | data-testid | data-slot |
|---------|-------------|-----------|
| Layout (loading) | `app-layout-loading` | `loading-spinner-wrapper` |
| Layout | `app-layout` | `MainLayout` |
| Main content | `app-main` | — |

### Solo Flow
| Element | data-testid | data-slot |
|---------|-------------|-----------|
| Setup page | `solo-setup-page` | `SoloTripSetup` |
| Results (loading) | `solo-results-loading` | `loading-spinner-wrapper` |
| Results (AI suggested) | `solo-results-ai-suggested` | `SoloResults` |
| Results page | `solo-results-page` | `SoloResults` |
| Results header | `solo-results-header` | — |
| Results empty | `solo-results-empty` | `solo-results-empty` |
| Itinerary list | `itinerary-list` | `itinerary-list` |
| Itinerary card | `itinerary-card-{id}` | `itinerary-card` |
| Selected route sidebar | `selected-route-sidebar` | `selected-route-sidebar` |
| Booking (loading) | `solo-booking-loading` | `loading-spinner-wrapper` |
| Booking page | `solo-booking-page` | `SoloBooking` |
| Comparison (loading) | `solo-comparison-loading` | `loading-spinner-wrapper` |
| Comparison (empty) | `solo-comparison-empty` | `SoloComparison` |
| Comparison page | `solo-comparison-page` | `SoloComparison` |

### Group Flow
| Element | data-testid | data-slot |
|---------|-------------|-----------|
| Setup page | `group-setup-page` | `GroupTripSetup` |
| Dashboard page | `group-dashboard-page` | `GroupDashboard` |
| Results (loading) | `group-results-loading` | `loading-spinner-wrapper` |
| Results (AI suggested) | `group-results-ai-suggested` | `GroupResults` |
| Results page | `group-results-page` | `GroupResults` |

### Auth
| Element | data-testid | data-slot |
|---------|-------------|-----------|
| Login page | `login-page` | `Login` |
| Register page | `register-page` | `Signup` |

---

## Shared Components

| Component | data-testid | data-slot |
|-----------|-------------|-----------|
| Navigation | `navigation` | `Navigation` |
| Footer | `footer` | `Footer` |
| Trip card | `trip-card-{trip.id}` | `trip-card` |

---

## Usage

**Testing (e.g. React Testing Library):**
```ts
screen.getByTestId('solo-results-page')
screen.getByTestId('itinerary-card-1')
```

**Design / Code Connect:** Use `data-slot` to map Figma components (e.g. `SoloResults`, `itinerary-card`) to these DOM nodes.
