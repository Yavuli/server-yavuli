drop extension if exists "pg_net";

drop trigger if exists "trg_sync_favorites" on "public"."favorites";

revoke delete on table "public"."view_logs" from "anon";

revoke insert on table "public"."view_logs" from "anon";

revoke references on table "public"."view_logs" from "anon";

revoke select on table "public"."view_logs" from "anon";

revoke trigger on table "public"."view_logs" from "anon";

revoke truncate on table "public"."view_logs" from "anon";

revoke update on table "public"."view_logs" from "anon";

revoke delete on table "public"."view_logs" from "authenticated";

revoke insert on table "public"."view_logs" from "authenticated";

revoke references on table "public"."view_logs" from "authenticated";

revoke select on table "public"."view_logs" from "authenticated";

revoke trigger on table "public"."view_logs" from "authenticated";

revoke truncate on table "public"."view_logs" from "authenticated";

revoke update on table "public"."view_logs" from "authenticated";

revoke delete on table "public"."view_logs" from "service_role";

revoke insert on table "public"."view_logs" from "service_role";

revoke references on table "public"."view_logs" from "service_role";

revoke select on table "public"."view_logs" from "service_role";

revoke trigger on table "public"."view_logs" from "service_role";

revoke truncate on table "public"."view_logs" from "service_role";

revoke update on table "public"."view_logs" from "service_role";

alter table "public"."messages" drop constraint "messages_listing_id_fkey";

alter table "public"."messages" drop constraint "messages_receiver_id_fkey";

alter table "public"."view_logs" drop constraint "view_logs_listing_id_fkey";

alter table "public"."view_logs" drop constraint "view_logs_user_id_fkey";

alter table "public"."messages" drop constraint "messages_sender_id_fkey";

drop function if exists "public"."get_client_ip"();

drop function if exists "public"."increment_view_count"(listing_id_param bigint, user_id_param uuid);

drop function if exists "public"."increment_view_count"(listing_id_param uuid, user_id_param uuid);

drop function if exists "public"."sync_favorites_count"();

drop function if exists "public"."update_favorites_count"();

alter table "public"."view_logs" drop constraint "view_logs_pkey";

drop index if exists "public"."idx_favorites_listing_id";

drop index if exists "public"."idx_favorites_user_id";

drop index if exists "public"."idx_messages_is_read";

drop index if exists "public"."idx_messages_listing_id";

drop index if exists "public"."idx_messages_sender_receiver";

drop index if exists "public"."idx_view_logs_ip";

drop index if exists "public"."idx_view_logs_listing_id";

drop index if exists "public"."idx_view_logs_user_id";

drop index if exists "public"."view_logs_pkey";

drop table "public"."view_logs";


  create table "public"."conversations" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "listing_id" uuid not null,
    "buyer_id" uuid not null,
    "seller_id" uuid not null
      );


alter table "public"."conversations" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "full_name" text,
    "avatar_url" text,
    "updated_at" timestamp with time zone default now(),
    "college_email" text,
    "college_name" text,
    "phone" text
      );


alter table "public"."profiles" enable row level security;

alter table "public"."favorites" alter column "listing_id" set not null;

alter table "public"."favorites" alter column "user_id" set not null;

alter table "public"."favorites" enable row level security;

alter table "public"."listings" drop column "favorites_count";

alter table "public"."listings" alter column "favorites" drop default;

alter table "public"."listings" enable row level security;

alter table "public"."messages" drop column "listing_id";

alter table "public"."messages" drop column "receiver_id";

alter table "public"."messages" add column "conversation_id" uuid not null;

alter table "public"."messages" alter column "created_at" set not null;

alter table "public"."messages" alter column "created_at" set data type timestamp with time zone using "created_at"::timestamp with time zone;

alter table "public"."messages" alter column "sender_id" set not null;

alter table "public"."messages" enable row level security;

alter table "public"."users" drop column "password_hash";

CREATE UNIQUE INDEX conversations_listing_id_buyer_id_seller_id_key ON public.conversations USING btree (listing_id, buyer_id, seller_id);

CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

alter table "public"."conversations" add constraint "conversations_pkey" PRIMARY KEY using index "conversations_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."conversations" add constraint "conversations_buyer_id_fkey" FOREIGN KEY (buyer_id) REFERENCES public.users(id) not valid;

alter table "public"."conversations" validate constraint "conversations_buyer_id_fkey";

alter table "public"."conversations" add constraint "conversations_listing_id_buyer_id_seller_id_key" UNIQUE using index "conversations_listing_id_buyer_id_seller_id_key";

alter table "public"."conversations" add constraint "conversations_listing_id_fkey" FOREIGN KEY (listing_id) REFERENCES public.listings(id) not valid;

alter table "public"."conversations" validate constraint "conversations_listing_id_fkey";

alter table "public"."conversations" add constraint "conversations_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES public.users(id) not valid;

alter table "public"."conversations" validate constraint "conversations_seller_id_fkey";

alter table "public"."messages" add constraint "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE not valid;

alter table "public"."messages" validate constraint "messages_conversation_id_fkey";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."messages" add constraint "messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES public.users(id) not valid;

alter table "public"."messages" validate constraint "messages_sender_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.get_unread_count()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  return (
    select count(*)
    from messages m
    join conversations c on m.conversation_id = c.id
    where 
      m.is_read = false 
      and m.sender_id != auth.uid() -- Message was sent BY someone else
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid()) -- It belongs to my chat
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_email_verification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE public.users
  SET is_verified = TRUE,
      updated_at = NOW()
  WHERE email = NEW.email;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, updated_at)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'fullName',
      split_part(NEW.email, '@', 1)
    ),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE 
  SET 
    full_name = EXCLUDED.full_name,
    updated_at = NOW();
  RETURN NEW;
END;
$function$
;

grant delete on table "public"."conversations" to "anon";

grant insert on table "public"."conversations" to "anon";

grant references on table "public"."conversations" to "anon";

grant select on table "public"."conversations" to "anon";

grant trigger on table "public"."conversations" to "anon";

grant truncate on table "public"."conversations" to "anon";

grant update on table "public"."conversations" to "anon";

grant delete on table "public"."conversations" to "authenticated";

grant insert on table "public"."conversations" to "authenticated";

grant references on table "public"."conversations" to "authenticated";

grant select on table "public"."conversations" to "authenticated";

grant trigger on table "public"."conversations" to "authenticated";

grant truncate on table "public"."conversations" to "authenticated";

grant update on table "public"."conversations" to "authenticated";

grant delete on table "public"."conversations" to "service_role";

grant insert on table "public"."conversations" to "service_role";

grant references on table "public"."conversations" to "service_role";

grant select on table "public"."conversations" to "service_role";

grant trigger on table "public"."conversations" to "service_role";

grant truncate on table "public"."conversations" to "service_role";

grant update on table "public"."conversations" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";


  create policy "Buyers can start conversation"
  on "public"."conversations"
  as permissive
  for insert
  to public
with check ((auth.uid() = buyer_id));



  create policy "user can view their own conversations"
  on "public"."conversations"
  as permissive
  for select
  to public
using (((auth.uid() = buyer_id) OR (auth.uid() = seller_id)));



  create policy "Users can add favorites"
  on "public"."favorites"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can remove favorites"
  on "public"."favorites"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can view their own favorites"
  on "public"."favorites"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "User can view thier messages in the thier own chats"
  on "public"."messages"
  as permissive
  for select
  to public
using ((EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.buyer_id = auth.uid()) OR (conversations.seller_id = auth.uid()))))));



  create policy "Users can send messages"
  on "public"."messages"
  as permissive
  for insert
  to public
with check (((auth.uid() = sender_id) AND (EXISTS ( SELECT 1
   FROM public.conversations
  WHERE ((conversations.id = messages.conversation_id) AND ((conversations.buyer_id = auth.uid()) OR (conversations.seller_id = auth.uid())))))));



  create policy "Public profiles are viewable by everyone"
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);



  create policy "Public profiles are viewable by everyone."
  on "public"."profiles"
  as permissive
  for select
  to public
using (true);



  create policy "Users can create their own profile"
  on "public"."profiles"
  as permissive
  for insert
  to authenticated
with check ((auth.uid() = id));



  create policy "Users can insert their own profile."
  on "public"."profiles"
  as permissive
  for insert
  to public
with check ((auth.uid() = id));



  create policy "Users can update own profile"
  on "public"."profiles"
  as permissive
  for update
  to authenticated
using ((auth.uid() = id))
with check ((auth.uid() = id));



  create policy "Users can update own profile."
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id));


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_verified AFTER UPDATE OF email_confirmed_at ON auth.users FOR EACH ROW WHEN ((new.email_confirmed_at IS NOT NULL)) EXECUTE FUNCTION public.handle_email_verification();

drop trigger if exists "objects_delete_delete_prefix" on "storage"."objects";

drop trigger if exists "objects_insert_create_prefix" on "storage"."objects";

drop trigger if exists "objects_update_create_prefix" on "storage"."objects";

drop trigger if exists "prefixes_create_hierarchy" on "storage"."prefixes";

drop trigger if exists "prefixes_delete_hierarchy" on "storage"."prefixes";

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


