'use client';

interface RouteMapProps {
    cities: string[];
}

export function RouteMap({ cities }: RouteMapProps) {
    return (
        <div className="relative h-32 bg-gradient-to-br from-blue-100 to-orange-50 rounded-xl overflow-hidden">
            <svg className="w-full h-full" viewBox="0 0 300 120">
                {/* Connection lines */}
                {cities.map((_, index) => {
                    if (index === cities.length - 1) return null;
                    const x1 = 40 + (index * (220 / (cities.length - 1)));
                    const x2 = 40 + ((index + 1) * (220 / (cities.length - 1)));
                    const y = 60;

                    return (
                        <line
                            key={`line-${index}`}
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke="#3B82F6"
                            strokeWidth="2"
                            strokeDasharray="4,2"
                        />
                    );
                })}

                {/* City markers */}
                {cities.map((city, index) => {
                    const x = 40 + (index * (220 / (cities.length - 1)));
                    const y = 60;

                    return (
                        <g key={`city-${index}`}>
                            <circle
                                cx={x}
                                cy={y}
                                r="8"
                                fill={index === 0 || index === cities.length - 1 ? '#F97316' : '#3B82F6'}
                            />
                            <text
                                x={x}
                                y={y + 25}
                                textAnchor="middle"
                                className="text-xs"
                                fill="#374151"
                            >
                                {city.substring(0, 3).toUpperCase()}
                            </text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
}
