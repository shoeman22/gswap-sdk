---
sidebar_position: 2
---

# Branded Types

The GalaSwap SDK uses TypeScript branded types to prevent common mistakes when working with prices and amounts. These types help avoid, for example, mixing up regular prices with square root prices, which can lead to calculation errors.

## What are Branded Types?

Branded types are a TypeScript pattern that adds compile-time safety by "branding" primitive types with additional metadata. This prevents you from accidentally passing the wrong type of value to a function.

## Available Branded Types

### Price Types

| Type          | Description                                                          | Usage                                          |
| ------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| `PriceIn`     | Input price values (decimal string or BigNumber)                     | When providing price parameters to functions   |
| `Price`       | Calculated price values (always BigNumber)                           | When receiving price results from calculations |
| `SqrtPriceIn` | Input square root price values (decimal string or BigNumber)         | When providing square root price parameters    |
| `SqrtPrice`   | Calculated square root price values (always BigNumber)               | When receiving square root price results       |

## Usage Example

### Casting

Financial inputs are decimal strings or `BigNumber` instances. Branded values are accepted by the SDK's price APIs:

```typescript
function myFunction(price: PriceIn) {
  // ...
}

myFunction('0.5' as PriceIn);
myFunction(new BigNumber('0.5') as PriceIn);

myFunction(0.5); // ERROR!
```

The point of forcing this casting is to require the caller to declare explicitly that they are passing in a price value (as opposed to a square root price value, or some other numeric value) thus helping to prevent incorrect data being used.
