# Tiến trình chiến kê

## Phần thưởng
- Thóc: 1 điểm thưởng.
- Châu chấu: 5 điểm thưởng.
- Gà mái: 20 điểm thưởng.
- Sức mạnh = 100 + floor(2 * sqrt(điểm thưởng)), tối đa 130.

Công thức dùng lợi ích giảm dần để gà lâu năm mạnh hơn nhưng không áp đảo người mới.

## Hai chế độ trận
- **Cân bằng**: cả hai gà luôn có Power 100. Phần thưởng vẫn được lưu nhưng không ảnh hưởng trận.
- **Sức mạnh tích lũy**: Power 100–130. Engine hiện áp dụng tối đa +15% sát thương ở Power 130.

## Nguyên tắc chống gian lận
Trình duyệt không được quyền tự cộng phần thưởng, sửa tổng thưởng hoặc ghi kết quả trận. Máy chủ phòng phải xác minh người chơi, kết quả và chế độ trận rồi mới ghi game_matches, game_reward_ledger và cập nhật tổng thưởng trên game_roosters.

## Trạng thái tích hợp Supabase
Migration được chuẩn bị trong supabase/rooster_progression.sql. Chỉ áp dụng vào project Supabase dành cho game; không dùng project Strava.
