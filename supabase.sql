-- Epicure Pizza production schema. Run in Supabase SQL Editor.
create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('customer', 'admin', 'super_admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.order_status as enum ('pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null,
  price numeric(10,2) not null check (price >= 0),
  image_url text,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.restaurant_settings (
  id smallint primary key check (id = 1),
  delivery_fee numeric(10,2) not null default 0 check (delivery_fee >= 0),
  updated_at timestamptz not null default now()
);
insert into public.restaurant_settings(id, delivery_fee) values (1, 0) on conflict (id) do nothing;
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  phone text not null,
  fulfillment text not null check (fulfillment in ('pickup','delivery')),
  address text,
  notes text not null default '',
  status public.order_status not null default 'pending',
  subtotal numeric(10,2) not null check (subtotal >= 0),
  total numeric(10,2) not null check (total >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  line_total numeric(10,2) not null check (line_total >= 0)
);
create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists orders_created_idx on public.orders(created_at desc);
create index if not exists products_available_order_idx on public.products(is_available, sort_order);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name','')) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() in ('admin','super_admin'), false)
$$;
create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'super_admin', false)
$$;
revoke all on function public.current_app_role() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_super_admin() from public;
grant execute on function public.current_app_role() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_super_admin() to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Profiles visible to self or staff" on public.profiles;
create policy "Profiles visible to self or staff" on public.profiles for select to authenticated using (id = (select auth.uid()) or public.is_staff());
drop policy if exists "Users update own profile name" on public.profiles;
create policy "Users update own profile name" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists "Anyone reads available products" on public.products;
create policy "Anyone reads available products" on public.products for select to anon, authenticated using (is_available or public.is_staff());
drop policy if exists "Staff creates products" on public.products;
create policy "Staff creates products" on public.products for insert to authenticated with check (public.is_staff());
drop policy if exists "Staff updates products" on public.products;
create policy "Staff updates products" on public.products for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists "Staff deletes products" on public.products;
create policy "Staff deletes products" on public.products for delete to authenticated using (public.is_staff());

drop policy if exists "Anyone reads restaurant settings" on public.restaurant_settings;
create policy "Anyone reads restaurant settings" on public.restaurant_settings for select to anon, authenticated using (true);
drop policy if exists "Staff updates restaurant settings" on public.restaurant_settings;
create policy "Staff updates restaurant settings" on public.restaurant_settings for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke update on public.restaurant_settings from authenticated;
grant update (delivery_fee) on public.restaurant_settings to authenticated;

drop policy if exists "Customers read own orders and staff read all" on public.orders;
create policy "Customers read own orders and staff read all" on public.orders for select to authenticated using (customer_id = (select auth.uid()) or public.is_staff());
drop policy if exists "Staff update order status" on public.orders;
create policy "Staff update order status" on public.orders for update to authenticated using (public.is_staff()) with check (public.is_staff());
revoke update on public.orders from authenticated;
grant update (status) on public.orders to authenticated;
drop policy if exists "Customer or staff read order lines" on public.order_items;
create policy "Customer or staff read order lines" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or public.is_staff())));

-- Prices are read from products on the server; browser-supplied prices are never trusted.
create or replace function public.create_order(p_fulfillment text, p_customer_name text, p_phone text, p_address text, p_notes text, p_items jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_order_id uuid := gen_random_uuid();
  item jsonb;
  product_record public.products%rowtype;
  item_quantity integer;
  calculated_subtotal numeric(10,2) := 0;
  server_delivery_fee numeric(10,2) := 0;
begin
  if auth.uid() is null then raise exception 'Sign in before placing an order.'; end if;
  if p_fulfillment not in ('pickup','delivery') then raise exception 'Choose pickup or delivery.'; end if;
  if length(trim(coalesce(p_customer_name,''))) < 2 or length(trim(coalesce(p_phone,''))) < 5 then raise exception 'Enter a valid name and phone number.'; end if;
  if p_fulfillment = 'delivery' and length(trim(coalesce(p_address,''))) < 5 then raise exception 'Enter a delivery address.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then raise exception 'Your bag is empty or contains too many lines.'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_quantity := (item->>'quantity')::integer;
    if item_quantity < 1 or item_quantity > 50 then raise exception 'Invalid item quantity.'; end if;
    select * into product_record from public.products where id = (item->>'product_id')::uuid and is_available = true;
    if not found then raise exception 'One of these menu items is no longer available.'; end if;
    calculated_subtotal := calculated_subtotal + product_record.price * item_quantity;
  end loop;
  if p_fulfillment = 'delivery' then
    select delivery_fee into server_delivery_fee from public.restaurant_settings where id = 1;
    server_delivery_fee := coalesce(server_delivery_fee, 0);
  end if;
  insert into public.orders(id, customer_id, customer_name, phone, fulfillment, address, notes, subtotal, total)
    values (new_order_id, auth.uid(), trim(p_customer_name), trim(p_phone), p_fulfillment, nullif(trim(coalesce(p_address,'')),''), left(trim(coalesce(p_notes,'')),1000), calculated_subtotal, calculated_subtotal + server_delivery_fee);
  for item in select value from jsonb_array_elements(p_items) loop
    item_quantity := (item->>'quantity')::integer;
    select * into product_record from public.products where id = (item->>'product_id')::uuid and is_available = true;
    insert into public.order_items(order_id, product_id, name, quantity, unit_price, line_total)
      values (new_order_id, product_record.id, product_record.name, item_quantity, product_record.price, product_record.price * item_quantity);
  end loop;
  return new_order_id;
end $$;
revoke all on function public.create_order(text,text,text,text,text,jsonb) from public;
grant execute on function public.create_order(text,text,text,text,text,jsonb) to authenticated;

create or replace function public.set_user_role(p_user_id uuid, p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super-admin can manage team roles.'; end if;
  if p_user_id = auth.uid() and p_role <> 'super_admin' then raise exception 'You cannot remove your own super-admin role.'; end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then raise exception 'User account not found.'; end if;
end $$;
revoke all on function public.set_user_role(uuid,public.app_role) from public;
grant execute on function public.set_user_role(uuid,public.app_role) to authenticated;

-- Seed menu items. Change names, descriptions, categories, and prices to the client's real menu.
insert into public.products(name,description,category,price,sort_order)
select seed.name, seed.description, seed.category, seed.price, seed.sort_order
from (values
  ('Margherita Classica','San Marzano tomato · fior di latte · basil · olive oil','Pizza',14,1),
  ('Green Goddess','Roasted zucchini · pesto · artichoke · whipped ricotta','Pizza',17,2),
  ('Hot Honey Pep','Double pepperoni · mozzarella · chilli honey · oregano','Pizza',18,3),
  ('Garlic Knots','Wood-fired knots · roasted garlic butter · parmesan','Sides',7,4),
  ('Tiramisu','Espresso-soaked layers · mascarpone · cocoa','Dessert',8,5)
) as seed(name, description, category, price, sort_order)
where not exists (select 1 from public.products existing where existing.name = seed.name);

-- INITIAL SUPER-ADMIN SETUP:
-- 1) Create your own account through the website, then confirm your email.
-- 2) In Supabase Dashboard > Authentication > Users, copy your account UUID.
-- 3) Replace the UUID below, uncomment, and run this statement once in SQL Editor:
-- update public.profiles set role = 'super_admin' where id = 'YOUR-AUTH-USER-UUID-HERE';
