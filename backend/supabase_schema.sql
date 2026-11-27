create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  address text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles as existing_profile (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = case
          when existing_profile.full_name = '' then excluded.full_name
          else existing_profile.full_name
        end;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create table if not exists public.book_catalog (
  id text primary key,
  title text not null,
  price bigint not null check (price > 0),
  in_stock boolean not null default true
);

alter table public.book_catalog enable row level security;
revoke all on public.book_catalog from anon, authenticated;
grant select on public.book_catalog to anon, authenticated;
drop policy if exists book_catalog_read_all on public.book_catalog;
create policy book_catalog_read_all on public.book_catalog
  for select to anon, authenticated using (true);

insert into public.book_catalog (id, title, price, in_stock)
values
  ('book_01', 'Chú Thuật Hồi Chiến - Tập 20', 30000, true),
  ('book_02', 'Thám Tử Lừng Danh Conan - Tập 100', 25000, true),
  ('book_03', 'Về Chuyện Tôi Chuyển Sinh Thành Slime - Tập 5', 115000, true),
  ('book_04', 'Dáng Hình Thanh Âm - Trọn Bộ Boxset 7 Tập', 245000, true),
  ('book_05', 'Spy x Family - Gia Đình Điệp Viên Tập 12', 25000, false)
on conflict (id) do update
  set title = excluded.title,
      price = excluded.price,
      in_stock = excluded.in_stock;

create table if not exists public.cart_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id text not null references public.book_catalog (id),
  quantity integer not null check (quantity between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.cart_items enable row level security;
grant select, insert, update, delete on public.cart_items to authenticated;
drop policy if exists cart_items_select_own on public.cart_items;
create policy cart_items_select_own on public.cart_items
  for select to authenticated using (user_id = auth.uid());
drop policy if exists cart_items_insert_own on public.cart_items;
create policy cart_items_insert_own on public.cart_items
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists cart_items_update_own on public.cart_items;
create policy cart_items_update_own on public.cart_items
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists cart_items_delete_own on public.cart_items;
create policy cart_items_delete_own on public.cart_items
  for delete to authenticated using (user_id = auth.uid());

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null,
  address text not null,
  total bigint not null check (total > 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'shipped', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  book_id text not null references public.book_catalog (id),
  title text not null,
  unit_price bigint not null check (unit_price > 0),
  quantity integer not null check (quantity between 1 and 99)
);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
revoke all on public.orders, public.order_items from anon, authenticated;
grant select on public.orders, public.order_items to authenticated;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = auth.uid());
drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id and orders.user_id = auth.uid()
    )
  );

create or replace function public.place_order(
  p_full_name text,
  p_phone text,
  p_address text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_book_id text;
  v_quantity integer;
  v_title text;
  v_price bigint;
  v_in_stock boolean;
  v_total bigint := 0;
  v_order_id uuid;
begin
  if v_user_id is null then
    raise exception 'Bạn cần đăng nhập để tạo đơn hàng.';
  end if;
  if length(trim(coalesce(p_full_name, ''))) = 0
    or length(trim(coalesce(p_phone, ''))) = 0
    or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'Vui lòng nhập đầy đủ thông tin nhận hàng.';
  end if;
  if length(p_full_name) > 120 or length(p_phone) > 30 or length(p_address) > 300 then
    raise exception 'Thông tin nhận hàng vượt quá độ dài cho phép.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Danh sách sách trong đơn hàng không hợp lệ.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'Đơn hàng phải có từ 1 đến 20 loại sách.';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) as items(value)
  loop
    v_book_id := v_item ->> 'book_id';
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'Số lượng sách không hợp lệ.';
    end;
    if v_book_id is null or length(trim(v_book_id)) = 0
      or v_quantity is null or v_quantity < 1 or v_quantity > 99 then
      raise exception 'Số lượng sách không hợp lệ.';
    end if;

    select title, price, in_stock
      into v_title, v_price, v_in_stock
      from public.book_catalog
      where id = v_book_id;
    if not found then
      raise exception 'Sản phẩm không tồn tại: %.', v_book_id;
    end if;
    if not v_in_stock then
      raise exception 'Sản phẩm đã hết hàng: %.', v_title;
    end if;
    v_total := v_total + v_price * v_quantity;
  end loop;

  insert into public.orders (user_id, full_name, phone, address, total)
  values (v_user_id, trim(p_full_name), trim(p_phone), trim(p_address), v_total)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items) as items(value)
  loop
    v_book_id := v_item ->> 'book_id';
    v_quantity := (v_item ->> 'quantity')::integer;
    select title, price into v_title, v_price
      from public.book_catalog where id = v_book_id;
    insert into public.order_items (order_id, book_id, title, unit_price, quantity)
    values (v_order_id, v_book_id, v_title, v_price, v_quantity);
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.place_order(text, text, text, jsonb) from public, anon;
grant execute on function public.place_order(text, text, text, jsonb) to authenticated;
