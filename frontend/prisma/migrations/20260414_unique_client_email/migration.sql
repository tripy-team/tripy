-- CreateIndex: unique email per organization (NULLs are not constrained)
CREATE UNIQUE INDEX "clients_organization_id_email_key" ON "clients"("organization_id", "email");
