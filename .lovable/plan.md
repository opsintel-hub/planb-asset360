
## เป้าหมาย
เพิ่มช่อง "ค้นหาสถานที่" บนหน้า Asset Map เพื่อให้ผู้ใช้พิมพ์ชื่อสถานที่ (เช่น "สุขุมวิท 22", "เดอะมอลล์บางกะปิ", "สาทร", "BTS อโศก", ชื่อถนน/ซอย/ห้าง/สถานี/จังหวัด) แล้วแผนที่ซูมและ pan ไปยังตำแหน่งนั้นทันที ไม่ต้องเลื่อนเมาส์เอง

## ตำแหน่ง UI
ใช้พื้นที่ว่างบนแถบเครื่องมือเหนือแผนที่ (ตรงตำแหน่งที่ผู้ใช้ชี้ในภาพ ข้างขวาของ dropdown "200 m / 200") — วางเป็น input พร้อมไอคอน 🔍 และ dropdown แสดง suggestion อัตโนมัติ

```text
[Draw Route] [↶] [↷] [200m ▼] [200]    [🔍 ค้นหาสถานที่ เช่น สุขุมวิท 22, เดอะมอลล์บางกะปิ ▼]
                                       ├─ สุขุมวิท 22, คลองเตย, กรุงเทพ
                                       ├─ ซอยสุขุมวิท 22, วัฒนา
                                       └─ ...
```

- ความกว้าง ~320px, อยู่ในแถวเดียวกันกับปุ่ม Draw Route (บน desktop) / ตกลงมาบรรทัดใหม่บน mobile
- Placeholder ตัวอย่าง: "ค้นหาสถานที่ / ห้าง / BTS / ถนน / ซอย"
- แสดง 3 ตัวอย่างเป็น chip เล็กๆ ใต้ช่อง (คลิกได้): "สุขุมวิท 22", "เดอะมอลล์บางกะปิ", "สาทร" — เพื่อให้ผู้ใช้ไม่ต้องคิดว่าจะพิมพ์อะไร

## พฤติกรรม
1. ผู้ใช้พิมพ์ → debounce 300ms → เรียก Google Places Autocomplete (New) ผ่าน `AutocompleteSuggestion.fetchAutocompleteSuggestions` (browser key ที่มีอยู่แล้ว) โดยจำกัด region = TH เพื่อให้ผลตรงกับประเทศไทย
2. แสดง dropdown สูงสุด 6 รายการ (main text + secondary text)
3. คลิกรายการ (หรือกด Enter รายการแรก) → เรียก Place Details ผ่าน gateway (`places/v1/places/{placeId}` field mask: `location,viewport,displayName`) เอา `location` + `viewport`
4. แผนที่ทำ `map.fitBounds(viewport)` ถ้ามี viewport (ครอบคลุมทั้งห้าง/ซอยยาว); ถ้าไม่มีก็ `map.panTo(location)` + `setZoom(17)` สำหรับจุดเล็ก / `16` สำหรับพื้นที่กว้าง
5. ปักหมุดชั่วคราว (ไอคอนต่างจาก asset marker เช่น pin สีน้ำเงินพร้อม label ชื่อสถานที่) หายไปเมื่อผู้ใช้ค้นหาใหม่หรือคลิกปุ่มปิด
6. ESC ปิด dropdown; ปุ่ม "×" ล้าง input + ลบหมุด
7. ถ้า Google API ล้มเหลว → fallback ไป Nominatim (OSM) แบบเดิมเงียบๆ แสดง toast เมื่อทั้งสองล้มเหลว

## Technical

### Files to edit
- `src/components/asset-map.tsx` — expose imperative handle (`flyTo(location, viewport?)`, `setTempPin(location, label)`, `clearTempPin()`) ผ่าน `forwardRef` + `useImperativeHandle`. เพิ่ม state สำหรับหมุดชั่วคราว
- `src/routes/map.tsx` — เพิ่มคอมโพเนนต์ `<PlaceSearchBox />` ในแถบเครื่องมือ, เก็บ ref ไปยัง asset-map, wire callback

### Files to create
- `src/components/place-search-box.tsx` — input + suggestion dropdown, ใช้ `loadGoogleMaps()` (มีอยู่แล้ว รองรับ libraries=streetView; จะเพิ่ม `places` เข้าไปด้วย) เพื่อโหลด `AutocompleteSuggestion` และ session token
- `src/lib/place-details.ts` — helper เรียก `places/v1/places/{id}` ผ่าน connector gateway (ต้องใช้ server-side เพราะ field mask + REST); สร้างเป็น `createServerFn` เพื่อไม่ให้ browser key โดน CORS

### Update `src/lib/google-maps-loader.ts`
เปลี่ยน `libraries: "streetView"` → `libraries: "streetView,places"` เพื่อให้ `importLibrary("places")` ใช้ได้

### Server function (new file `src/lib/places.functions.ts`)
```ts
export const getPlaceDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { placeId: string }) => d)
  .handler(async ({ data }) => {
    // fetch places/v1/places/{placeId} with X-Goog-FieldMask: id,displayName,location,viewport
    // return { lat, lng, viewport?: {north,south,east,west}, displayName }
  });
```

## ไม่ทำ (out of scope)
- ไม่ค้นหา asset ในระบบ (มีช่อง "ค้นหา Old Code / ชื่อ / ทำเล" อยู่แล้ว)
- ไม่เก็บประวัติการค้นหา (เพิ่มทีหลังได้)
- ไม่รองรับ voice/geolocation
