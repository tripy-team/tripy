'use client';

import React from 'react';
import {
  PolicyEvaluation,
  PolicyMessage,
  getSeverityClasses,
  requiresAcknowledgment,
  isFullyAcknowledged,
  getCodeDescription,
  REASON_CODES,
} from '@/lib/policyConfig';

// Warning codes to hide from the UI
const HIDDEN_WARNING_CODES = [
  REASON_CODES.FLIGHT_UNPROTECTED_CONNECTION,
  REASON_CODES.FLIGHT_OVERNIGHT_CONNECTION,
];

// =============================================================================
// POLICY MESSAGE ITEM
// =============================================================================

interface PolicyMessageItemProps {
  message: PolicyMessage;
  acknowledged?: boolean;
  onAcknowledge?: (code: string) => void;
  showAckCheckbox?: boolean;
}

export function PolicyMessageItem({
  message,
  acknowledged = false,
  onAcknowledge,
  showAckCheckbox = false,
}: PolicyMessageItemProps) {
  const classes = getSeverityClasses(message.severity);

  return (
    <div
      className={`rounded-lg p-3 ${classes.bg} ${classes.border} border`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">{classes.icon}</span>
        <div className="flex-1 min-w-0">
          <h4 className={`font-medium ${classes.text}`}>{message.title}</h4>
          <p className="text-sm text-gray-600 mt-1">{message.detail}</p>

          {/* Show acknowledgment checkbox if required */}
          {showAckCheckbox && message.requires_ack && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={() => onAcknowledge?.(message.code)}
                className="rounded border-gray-300 text-blue-600 
                         focus:ring-blue-500 h-4 w-4"
              />
              <span className="text-sm text-gray-700">
                {message.ack_text || 'I understand this risk'}
              </span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// POLICY WARNINGS LIST
// =============================================================================

interface PolicyWarningsProps {
  evaluation: PolicyEvaluation;
  acknowledgedCodes?: string[];
  onAcknowledge?: (code: string) => void;
  showAckCheckboxes?: boolean;
  collapsed?: boolean;
  className?: string;
}

export function PolicyWarnings({
  evaluation,
  acknowledgedCodes = [],
  onAcknowledge,
  showAckCheckboxes = true,
  collapsed = false,
  className = '',
}: PolicyWarningsProps) {
  const [isExpanded, setIsExpanded] = React.useState(!collapsed);

  // Handle undefined/null evaluation
  if (!evaluation) {
    return null;
  }

  // Combine all messages for counting (with null checks)
  // Filter out hidden warning codes
  const blocks = evaluation.blocks ?? [];
  const warnings = (evaluation.warnings ?? []).filter(
    (msg) => !HIDDEN_WARNING_CODES.includes(msg.code)
  );
  const info = (evaluation.info ?? []).filter(
    (msg) => !HIDDEN_WARNING_CODES.includes(msg.code)
  );
  const totalMessages = blocks.length + warnings.length + info.length;

  if (totalMessages === 0) {
    return null;
  }

  const hasBlocks = blocks.length > 0;
  const hasWarnings = warnings.length > 0;
  const needsAck = requiresAcknowledgment(evaluation);
  const fullyAcked = isFullyAcknowledged(evaluation, acknowledgedCodes);

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        hasBlocks
          ? 'border-red-200 bg-red-50/30'
          : hasWarnings
          ? 'border-yellow-200 bg-yellow-50/30'
          : 'border-gray-200 bg-gray-50/30'
      } ${className}`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between 
                   hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">
            {hasBlocks ? '🚫' : hasWarnings ? '⚠️' : 'ℹ️'}
          </span>
          <span className="font-medium text-gray-900">
            {hasBlocks
              ? 'Blocked'
              : hasWarnings
              ? 'Warnings'
              : 'Information'}
          </span>
          <span className="text-sm text-gray-500">
            ({totalMessages} {totalMessages === 1 ? 'item' : 'items'})
          </span>

          {/* Acknowledgment status badge */}
          {needsAck && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                fullyAcked
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {fullyAcked ? 'Acknowledged' : 'Requires acknowledgment'}
            </span>
          )}
        </div>

        <span
          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        >
          ▼
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Blocks (most severe) */}
          {blocks.length > 0 && (
            <div className="space-y-2">
              {blocks.map((msg, i) => (
                <PolicyMessageItem
                  key={`block-${i}`}
                  message={msg}
                  acknowledged={acknowledgedCodes.includes(msg.code)}
                  onAcknowledge={onAcknowledge}
                  showAckCheckbox={showAckCheckboxes}
                />
              ))}
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((msg, i) => (
                <PolicyMessageItem
                  key={`warn-${i}`}
                  message={msg}
                  acknowledged={acknowledgedCodes.includes(msg.code)}
                  onAcknowledge={onAcknowledge}
                  showAckCheckbox={showAckCheckboxes}
                />
              ))}
            </div>
          )}

          {/* Info */}
          {info.length > 0 && (
            <div className="space-y-2">
              {info.map((msg, i) => (
                <PolicyMessageItem
                  key={`info-${i}`}
                  message={msg}
                  acknowledged={false}
                  showAckCheckbox={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ACKNOWLEDGMENT MODAL
// =============================================================================

interface AcknowledgmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (acknowledgedCodes: string[]) => void;
  evaluation: PolicyEvaluation;
  initialAcknowledged?: string[];
}

export function AcknowledgmentModal({
  isOpen,
  onClose,
  onConfirm,
  evaluation,
  initialAcknowledged = [],
}: AcknowledgmentModalProps) {
  const [acknowledged, setAcknowledged] = React.useState<string[]>(
    initialAcknowledged
  );

  // Get messages that require acknowledgment
  const messagesToAck = [
    ...blocks.filter((m) => m.requires_ack),
    ...warnings.filter((m) => m.requires_ack),
  ];

  const handleToggle = (code: string) => {
    setAcknowledged((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code]
    );
  };

  const allAcknowledged = evaluation.requires_ack.every((code) =>
    acknowledged.includes(code)
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Acknowledge Risks
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Please review and acknowledge the following risks before proceeding.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messagesToAck.map((msg, i) => (
            <PolicyMessageItem
              key={i}
              message={msg}
              acknowledged={acknowledged.includes(msg.code)}
              onAcknowledge={handleToggle}
              showAckCheckbox={true}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 
                     rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(acknowledged)}
            disabled={!allAcknowledged}
            className={`px-4 py-2 rounded-lg transition-colors ${
              allAcknowledged
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// INLINE WARNING BADGE
// =============================================================================

interface PolicyBadgeProps {
  evaluation: PolicyEvaluation;
  onClick?: () => void;
  className?: string;
}

export function PolicyBadge({
  evaluation,
  onClick,
  className = '',
}: PolicyBadgeProps) {
  // Handle undefined/null evaluation
  if (!evaluation) {
    return null;
  }

  // Filter out hidden warning codes
  const blocks = evaluation.blocks ?? [];
  const warnings = (evaluation.warnings ?? []).filter(
    (msg) => !HIDDEN_WARNING_CODES.includes(msg.code)
  );
  const info = (evaluation.info ?? []).filter(
    (msg) => !HIDDEN_WARNING_CODES.includes(msg.code)
  );
  
  const hasBlocks = blocks.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasInfo = info.length > 0;

  if (!hasBlocks && !hasWarnings && !hasInfo) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs
                  transition-colors ${
                    hasBlocks
                      ? 'bg-red-100 text-red-700 hover:bg-red-200'
                      : hasWarnings
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  } ${className}`}
    >
      <span>{hasBlocks ? '🚫' : hasWarnings ? '⚠️' : 'ℹ️'}</span>
      <span>
        {blocks.length + warnings.length + info.length}
      </span>
    </button>
  );
}

export default PolicyWarnings;
