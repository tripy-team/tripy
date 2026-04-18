-- CreateTable
CREATE TABLE "meeting_invitations" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "advisor_email" TEXT,
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_invitations_token_key" ON "meeting_invitations"("token");

-- CreateIndex
CREATE INDEX "meeting_invitations_client_id_idx" ON "meeting_invitations"("client_id");

-- CreateIndex
CREATE INDEX "meeting_invitations_meeting_session_id_idx" ON "meeting_invitations"("meeting_session_id");

-- CreateIndex
CREATE INDEX "meeting_invitations_token_idx" ON "meeting_invitations"("token");

-- AddForeignKey
ALTER TABLE "meeting_invitations" ADD CONSTRAINT "meeting_invitations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_invitations" ADD CONSTRAINT "meeting_invitations_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "discovery_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
