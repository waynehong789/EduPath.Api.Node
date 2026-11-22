# Database migrations

No committed migrations existed in the source version. From a fresh local PostgreSQL database run `npm run db:migrate -- --name init` in `EduPath.Api.Node`, then commit the generated timestamped migration directory. Do not run `migrate dev` against production. For an already-provisioned database, baseline carefully instead of blindly creating the schema.
