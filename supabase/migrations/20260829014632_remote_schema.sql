


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."check_staff_pin"("candidate" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select exists (
    select 1 from staff_auth where id = 'main' and pin_hash = extensions.crypt(candidate, pin_hash)
  );
$$;


ALTER FUNCTION "public"."check_staff_pin"("candidate" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_staff_pin"("old_pin" "text", "new_pin" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  if exists (select 1 from staff_auth where id = 'main' and pin_hash = extensions.crypt(old_pin, pin_hash)) then
    update staff_auth set pin_hash = extensions.crypt(new_pin, extensions.gen_salt('bf')) where id = 'main';
    return true;
  else
    return false;
  end if;
end;
$$;


ALTER FUNCTION "public"."set_staff_pin"("old_pin" "text", "new_pin" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "phone" "text" NOT NULL,
    "name" "text",
    "stamps" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."menu" (
    "id" "text" DEFAULT 'main'::"text" NOT NULL,
    "data" "jsonb" NOT NULL
);


ALTER TABLE "public"."menu" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "text" NOT NULL,
    "name" "text",
    "phone" "text",
    "date" timestamp with time zone DEFAULT "now"(),
    "items" "jsonb",
    "total" numeric,
    "notes" "text",
    "status" "text" DEFAULT 'Received'::"text",
    "stripe_session_id" "text"
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settings" (
    "id" "text" DEFAULT 'main'::"text" NOT NULL,
    "payment_enabled" boolean DEFAULT true NOT NULL,
    "stall_phone" "text" DEFAULT '+6596586775'::"text" NOT NULL,
    "stall_name" "text" DEFAULT 'Moocha'::"text" NOT NULL
);


ALTER TABLE "public"."settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_auth" (
    "id" "text" DEFAULT 'main'::"text" NOT NULL,
    "pin_hash" "text" NOT NULL
);


ALTER TABLE "public"."staff_auth" OWNER TO "postgres";


ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("phone");



ALTER TABLE ONLY "public"."menu"
    ADD CONSTRAINT "menu_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settings"
    ADD CONSTRAINT "settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_auth"
    ADD CONSTRAINT "staff_auth_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."menu" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public delete customers" ON "public"."customers" FOR DELETE USING (true);



CREATE POLICY "public delete orders" ON "public"."orders" FOR DELETE USING (true);



CREATE POLICY "public insert customers" ON "public"."customers" FOR INSERT WITH CHECK (true);



CREATE POLICY "public insert orders" ON "public"."orders" FOR INSERT WITH CHECK (true);



CREATE POLICY "public read customers" ON "public"."customers" FOR SELECT USING (true);



CREATE POLICY "public read menu" ON "public"."menu" FOR SELECT USING (true);



CREATE POLICY "public read orders" ON "public"."orders" FOR SELECT USING (true);



CREATE POLICY "public read settings" ON "public"."settings" FOR SELECT USING (true);



CREATE POLICY "public update customers" ON "public"."customers" FOR UPDATE USING (true);



CREATE POLICY "public update menu" ON "public"."menu" FOR UPDATE USING (true);



CREATE POLICY "public update orders" ON "public"."orders" FOR UPDATE USING (true);



CREATE POLICY "public update settings" ON "public"."settings" FOR UPDATE USING (true);



ALTER TABLE "public"."settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_auth" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."check_staff_pin"("candidate" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_staff_pin"("candidate" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_staff_pin"("candidate" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_staff_pin"("old_pin" "text", "new_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_staff_pin"("old_pin" "text", "new_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_staff_pin"("old_pin" "text", "new_pin" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."menu" TO "anon";
GRANT ALL ON TABLE "public"."menu" TO "authenticated";
GRANT ALL ON TABLE "public"."menu" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."settings" TO "anon";
GRANT ALL ON TABLE "public"."settings" TO "authenticated";
GRANT ALL ON TABLE "public"."settings" TO "service_role";



GRANT ALL ON TABLE "public"."staff_auth" TO "anon";
GRANT ALL ON TABLE "public"."staff_auth" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_auth" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


  create policy "public read menu photos"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'menu-photos'::text));



  create policy "public replace menu photos"
  on "storage"."objects"
  as permissive
  for update
  to public
using ((bucket_id = 'menu-photos'::text));



  create policy "public upload menu photos"
  on "storage"."objects"
  as permissive
  for insert
  to public
with check ((bucket_id = 'menu-photos'::text));



