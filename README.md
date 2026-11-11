# Đấu Trường Gà Online

Trò chơi đối kháng vui dành cho hai người, dùng bàn phím, với hình ảnh gà chân thực và chữ tiếng Việt được nhúng đầy đủ.

**Chơi ngay:** https://dau-truong-ga-quan.bidv-it-grou-8424.chatgpt.site

## Mời bạn chơi qua Internet

1. Mở trò chơi, nhập tên và chọn **Tạo phòng mới**.
2. Gửi **mã phòng 6 ký tự** hoặc dùng **Sao chép link mời bạn**.
3. Người thứ hai mở link trò chơi, nhập tên và mã, rồi chọn **Vào**.
4. Khi thấy tên nhau trong sảnh, cả hai chọn **Tôi đã sẵn sàng**.
5. Chủ phòng chọn **Bắt đầu trận**. Chủ phòng điều khiển Gà Điều; khách điều khiển Gà Trắng.
6. Sau trận, cả hai chọn **Đấu lại** để chơi tiếp trong cùng phòng.

Hai người có thể dùng hai mạng Internet khác nhau. Phòng tối đa hai người. Giữ trang game mở trong khi chơi; trận tạm chờ khi một người chuyển tab hoặc dữ liệu bị gián đoạn. Rời phòng hoặc tải lại trang sẽ đóng phiên hiện tại; tạo phòng mới để chơi tiếp.

## Điều khiển mặc định

| Hành động | Phím trên máy của mỗi người |
| --- | --- |
| Sang trái / phải | A / D |
| Nhảy | Space |
| Mổ | J |
| Đá | K |
| Thủ | L |
| Lướt né | Shift trái |

Nút **Đổi phím** cho phép chọn bộ Mũi tên + Z/X/C hoặc gán từng phím. Các chế độ luyện tập với máy và hai người chung bàn phím vẫn có sẵn.

## Mã nguồn và chạy cục bộ

Yêu cầu Node.js 24 trở lên, có `node:sqlite`. Không cần cài gói chạy ứng dụng.

```sh
npm run dev
npm test
npm run check
npm run build
```

Mở địa chỉ do máy chủ phát triển in ra. Hai tab có thể tạo/tham gia cùng phòng trong môi trường cục bộ. Cơ sở dữ liệu kiểm thử nằm trong `.sites-runtime/`, không được đưa lên Git.

Các phần chính:

- `client/shell.html`: giao diện, kiểu chữ và hướng dẫn tiếng Việt.
- `client/game-engine.js`: mô phỏng trận đấu và xử lý ra đòn.
- `client/game-app.js`: điều khiển bàn phím, sảnh, hiển thị và đồng bộ trận đấu.
- `client/rooster-net.js`: phòng online, chuyển tiếp HTTPS, kết nối trực tiếp tùy mạng.
- `worker/rooms.js`: API phòng và lưu trạng thái bằng D1.
- `drizzle/`: migration cơ sở dữ liệu.
- `assets/`: hình gà, sân đấu và font được dùng trong game.
- `scripts/build.mjs`: tạo Worker triển khai, một file HTML tự chứa và frontend dùng trên GitHub Pages.

Build xuất `dist/server/index.js`, `outputs/dau-truong-ga.html` và `outputs/github-index.html`. Bản HTML tự chứa giữ hình ảnh/font để chơi ngoại tuyến; chế độ online vẫn cần dịch vụ phòng đang hoạt động tại địa chỉ trò chơi ở trên. Frontend GitHub Pages dùng API và hình ảnh/font từ dịch vụ đã triển khai. GitHub Pages riêng lẻ không chạy Worker/D1.

## Cách đồng bộ

Chủ phòng chạy mô phỏng trận đấu và gửi trạng thái cho khách; khách gửi phím điều khiển. Máy chủ cấp phòng, kiểm tra tư cách người chơi, giới hạn hai người, kiểm tra sẵn sàng và chuyển tiếp dữ liệu. Khi hai mạng cho phép, PeerJS/WebRTC truyền trực tiếp để giảm độ trễ. Nếu đường trực tiếp không hoạt động, trò chơi dùng HTTPS qua máy chủ.

Tín hiệu nhấn phím nhanh có bộ đếm để không mất thao tác giữa các lần trao đổi. Mã trận và số thứ tự loại bỏ gói cũ; yêu cầu đấu lại được giữ cho tới khi phía kia nhận. Khi dữ liệu tạm gián đoạn, trận dừng tiến triển và tự tiếp tục khi kết nối trở lại. Hết thời gian kết nối hoặc rời phòng sẽ kết thúc phiên, không tự tính thắng/thua.

Độ trễ thực tế phụ thuộc hai đường mạng và vị trí máy chủ; đường chuyển tiếp có thể chậm hơn kết nối trực tiếp. Đây là game chơi vui giữa bạn bè; chủ phòng có quyền mô phỏng trận và không có hệ thống chống gian lận cạnh tranh.

Font Noto Sans và thư viện PeerJS giữ thông báo giấy phép trong mã HTML/thư viện.
