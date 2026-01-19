# Cities JSON Format

## Structure

The `cities.json` file contains an array of city objects, each with the following structure:

```json
{
  "city": "Paris",
  "country": "France",
  "region": "Europe"
}
```

## Fields

- **city** (required): Name of the city
- **country** (optional): Country name - helps with better image search results
- **region** (optional): Geographic region (Europe, Asia, North America, etc.)

## Usage

### Single City

```bash
python scripts/curate_city_images.py --city "Paris" --country "France" --count 5
```

### Batch Processing

```bash
python scripts/curate_city_images.py --batch scripts/cities.json --count 5
```

The script automatically handles both formats:
- **Object format** (new): `{"city": "Paris", "country": "France", "region": "Europe"}`
- **String format** (legacy): `"Paris"`

## Benefits of Including Country

1. **Better Image Search**: Search terms like "Paris France" yield more relevant results
2. **Metadata Storage**: Country info stored in DynamoDB for filtering/display
3. **Future Features**: Can filter by country, show country flags, etc.

## Example

```json
[
  {"city": "Paris", "country": "France", "region": "Europe"},
  {"city": "Tokyo", "country": "Japan", "region": "Asia"},
  {"city": "New York", "country": "United States", "region": "North America"}
]
```
